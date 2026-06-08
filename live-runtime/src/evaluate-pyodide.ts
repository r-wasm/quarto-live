import { EnvironmentManager, EnvLabel, PyodideEnvironment } from './environment';
import { Indicator } from './indicator';
import { highlightPython } from './highlighter';
import type { PyProxy } from 'pyodide/ffi';
import {
  EvaluateContext,
  EvaluateOptions,
  ExerciseEvaluator,
  OJSEvaluateElement,
  EvaluateValue,
} from "./evaluate";
import { PyodideAPIWorker } from './pyodide-worker';
import { loadScriptAsync, replaceScriptChildren, b64Decode } from './utils';

import AnsiConvert from 'ansi-to-html';

declare global {
  interface Window {
    Plotly: any;
    _ojs: {
      ojsConnector: any;
    }
  }
}

let stateElement: HTMLScriptElement | undefined;
let plotly: boolean = false;

export class PyodideEvaluator implements ExerciseEvaluator {
  container: OJSEvaluateElement;
  context: EvaluateContext;
  options: EvaluateOptions;
  envManager: EnvironmentManager<PyodideEnvironment>;
  pyodide: PyodideAPIWorker;
  nullResult: EvaluateValue;
  constructor(pyodide: PyodideAPIWorker, context: EvaluateContext) {
    this.container = this.newContainer();
    this.nullResult = { result: null, evaluate_result: null, evaluator: this };
    this.container.value = this.nullResult;
    this.container.className = 'cell-output-container';
    this.pyodide = pyodide;
    this.context = context;
    this.envManager = new EnvironmentManager(PyodideEnvironment.instance(pyodide), context);

    // Default evaluation options
    this.options = Object.assign(
      {
        envir: "global",
        eval: true,
        echo: false,
        warning: true,
        error: true,
        include: true,
        output: true,
        timelimit: 30,
      },
      context.options
    );
  }

  newContainer() {
    const container = document.createElement('div');
    container.classList.add('cell-output-container');
    container.classList.add('cell-output-container-pyodide');
    return container;
  }

  getSetupCode(): string | undefined {
    const exId = this.options.exercise;
    const setup = document.querySelectorAll(
      `script[type=\"exercise-setup-${exId}-contents\"]`
    );
    if (setup.length > 0) {
      if (setup.length > 1) {
        console.warn(`Multiple \`setup\` blocks found for exercise "${exId}", using the first.`);
      }
      const block = JSON.parse(b64Decode(setup[0].textContent));
      return block.code;
    }
  }

  // Setup environment, execute setup code, execute user code, define outputs
  async process(inputs: { [key: string]: any }) {
    // If we're not evaluating, just print the source directly
    if (!this.options.eval) {
      this.container = this.asSourceHTML(this.context.code);
      this.container.value = this.nullResult;
      return;
    }

    // Don't evaluate code if this is an exercise and there's blanks, the grader
    // will deal with feedback to the user asking them to fill the blanks.
    if (this.options.exercise && this.context.code && this.context.code.match(/_{6}_*/g)) {
      this.container.value.result = null;
      return;
    }

    // Indicate processing
    let ind = this.context.indicator;
    if (!this.context.indicator) {
      ind = new Indicator();
    }
    ind.running();

    try {
      // Set OJS inputs in "prep" environment
      await Promise.all(
        Object.entries(inputs).map(async ([k, v]) => {
          await this.envManager.bind(k, v, "prep");
        })
      );

      // Run setup code, copy prep environment for result, run user code
      const setup = this.getSetupCode();
      await this.evaluate(setup, "prep");
      await this.envManager.create("result", "prep");
      const result = await this.evaluate(this.context.code, "result");

      // Once we have the evaluate result, render it's contents to HTML
      if (!result) {
        this.container.value.result = null;
      } else if (this.options.output === "asis") {
        this.container.innerHTML = await result.stdout;
      } else {
        this.container = await this.asHtml(result);
        if (!this.options.output) {
          // Don't show any output in HTML, but return a value
          const value = this.container.value;
          this.container = this.newContainer();
          this.container.value = value;
        }
      }

      // Grab defined objects from the result environment
      const envir = await this.envManager.get("result");
      const objs: { [key: string]: PyProxy } = {};
      if (typeof this.options.define === 'string') {
        objs[this.options.define] = await envir.get(this.options.define)
      } else if (this.options.define) {
        Object.assign(objs, Object.fromEntries(
          await Promise.all(
            this.options.define.map(async (name) => {
              const obj = await envir.get(name);
              return [name, obj];
            })
          )
        ));
      }

      // Define the grabbed objects as OJS values
      Object.keys(objs).forEach(async (key) => {
        const jsValue = await this.asOjs(objs[key]);
        if (window._ojs.ojsConnector.mainModule._scope.has(key)) {
          window._ojs.ojsConnector.mainModule.redefine(key, () => jsValue);
        } else {
          window._ojs.ojsConnector.define(key)(jsValue);
        }
      });

    } finally {
      ind.finished();
      if (!this.context.indicator) ind.destroy();
    }
  }

  async evaluate(code: string, envLabel: EnvLabel, options: EvaluateOptions = this.options) {
    if (code == null) {
      return null;
    }

    await this.pyodide.loadPackagesFromImports(code);
    let [width, height, dpi] = [7, 5, 100];
    if ("fig-width" in this.options) {
      width = Number(this.options["fig-width"]);
    }
    if ("fig-height" in this.options) {
      height = Number(this.options["fig-height"]);
    }
    if ("fig-dpi" in this.options) {
      dpi = Number(this.options["fig-dpi"]);
    }

    const locals = await this.pyodide.toPy({
      code,
      dpi,
      width,
      height,
      environment: await this.envManager.get(envLabel),
    });

    const resultObject = await this.pyodide.runPythonAsync(
      atob(require('./scripts/Python/capture.py'))
      , { locals });
    locals.destroy();

    const value = await resultObject.get("value");
    const stdout = await resultObject.get("stdout");
    const stderr = await resultObject.get("stderr");
    const outputs = await resultObject.get("outputs");

    return {
      value: value as unknown,
      stdout: stdout as string,
      stderr: stderr as string,
      outputs: outputs as PyProxy,
    };
  }

  asSourceHTML(code): HTMLDivElement {
    const sourceDiv = document.createElement("div");
    const sourcePre = document.createElement("pre");
    sourceDiv.className = "sourceCode";
    sourcePre.className = "sourceCode python";
    const sourceCode = highlightPython(code);
    sourcePre.appendChild(sourceCode);
    sourceDiv.appendChild(sourcePre);
    return sourceDiv;
  }

  // Convert pyodide Python object reference to OJS value
  async asOjs(value: any): Promise<any> {
    if (Object.getOwnPropertyNames(value).includes("toJs")) {
      return value.toJs();
    }
    return value;
  }

  async asHtml(
    result: Awaited<ReturnType<PyodideEvaluator["evaluate"]>>,
    options: EvaluateOptions = this.options
  ) {
    const container: OJSEvaluateElement = this.newContainer();
    container.value = this.nullResult;

    if (!result) {
      return container;
    }

    const appendImageBitmap = (image: ImageBitmap) => {
      if (image.width <= 1 && image.height <= 1) {
        // This is a blank or placeholder 1x1 pixel image, ignore it.
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.className = "img-fluid figure-img";
      canvas.style.width = `${2 * image.width / 3}px`;
      canvas.getContext('bitmaprenderer').transferFromImageBitmap(image);

      const outputDiv = document.createElement("div");
      outputDiv.className = "cell-output-display cell-output-pyodide";
      outputDiv.appendChild(canvas);

      if (options.output) {
        container.appendChild(outputDiv);
      }
    }

    const appendPlainText = (content: string) => {
      if (options.output) {
        const outputDiv = document.createElement("div");
        outputDiv.appendChild(document.createTextNode(content));
        outputDiv.className = "cell-output cell-output-pyodide";
        outputDiv.innerHTML = `<pre><code>${outputDiv.innerHTML}</code></pre>`;
        container.appendChild(outputDiv);
      }
    }

    const appendJupyterWidget = async (widget: PyProxy) => {
      // TODO: Hook this up to the running Python process for reactivity
      // c.f. https://github.com/jupyter-widgets/ipywidgets/tree/main/examples/web3
      const state = await this.pyodide.runPythonAsync(`
        import ipywidgets as widgets
        import json
        json.dumps(widgets.Widget.get_manager_state())
      `)

      if (!stateElement) {
        stateElement = document.createElement('script');
        stateElement.type = "application/vnd.jupyter.widget-state+json";
        stateElement = document.body.appendChild(stateElement);
        await loadScriptAsync("https://cdn.jsdelivr.net/npm/@jupyter-widgets/html-manager@1.0.11/dist/embed.js");
      }
      stateElement.innerHTML = state;

      const locals = await this.pyodide.toPy({ widget });
      const widgetJson = await this.pyodide.runPythonAsync(`
        import json
        json.dumps(widget)
      `, { locals });
      locals.destroy();
      const widgetElement = document.createElement('script');
      widgetElement.type = "application/vnd.jupyter.widget-view+json"
      widgetElement.innerHTML = widgetJson;
      container.appendChild(widgetElement);

      dispatchEvent(new Event('load'));
    }

    const appendPlotlyFigure = async (figure: PyProxy) => {
      const locals = await this.pyodide.toPy({ figure });
      const figureJson = await this.pyodide.runPythonAsync(`
        import json
        json.dumps(figure)
      `, { locals });

      if (!plotly) {
        await loadScriptAsync("https://cdn.plot.ly/plotly-2.35.2.min.js");
        plotly = true;
      }
      var figureObj = JSON.parse(figureJson);

      const figureDiv = document.createElement('div');
      window.Plotly.newPlot(figureDiv, figureObj.data, figureObj.layout);
      container.appendChild(figureDiv);
    }

    const appendHtml = async (html: string) => {
      if (options.output) {
        const outputDiv = document.createElement("div");
        outputDiv.className = "cell-output cell-output-pyodide";
        outputDiv.innerHTML = html;
        replaceScriptChildren(outputDiv);
        container.appendChild(outputDiv);
      }
    };

    const appendDataUrlImage = async (
      mime: string,
      data: string,
      metadata: Record<string, any> = {}
    ) => {
      if (options.output) {
        const outputDiv = document.createElement("div");
        const imageDiv = document.createElement("img");
        outputDiv.className = "cell-output-display cell-output-pyodide";
        imageDiv.src = `data:${mime};base64, ${data}`;
        if (typeof metadata.width === "number") {
          imageDiv.width = metadata.width;
        }
        if (typeof metadata.height === "number") {
          imageDiv.height = metadata.height;
        }
        outputDiv.appendChild(imageDiv);
        container.appendChild(outputDiv);
      }
    };

    if (options.echo) {
      const sourceDiv = document.createElement("div");
      const sourcePre = document.createElement("pre");
      sourceDiv.className = "sourceCode";
      sourcePre.className = "sourceCode python";
      const sourceCode = highlightPython(this.context.code);
      sourcePre.appendChild(sourceCode);
      sourceDiv.appendChild(sourcePre);
      container.appendChild(sourceDiv);
    }

    const ansi = new AnsiConvert({ escapeXML: true });
    if (result.stdout) {
      const outputDiv = document.createElement("div");
      outputDiv.className = "exercise-cell-output cell-output cell-output-pyodide cell-output-stdout";
      outputDiv.innerHTML = "<pre><code></code></pre>";
      const codeDiv = outputDiv.querySelector('code');
      codeDiv.textContent = result.stdout;
      codeDiv.innerHTML = ansi.toHtml(codeDiv.textContent);
      container.appendChild(outputDiv);
    }

    if (result.stderr) {
      const errorDiv = document.createElement("div");
      errorDiv.className = "exercise-cell-output cell-output cell-output-pyodide cell-output-stderr";
      errorDiv.innerHTML = "<pre><code></code></pre>";
      const codeDiv = errorDiv.querySelector('code');
      codeDiv.textContent = result.stderr;
      codeDiv.innerHTML = ansi.toHtml(codeDiv.textContent);
      container.appendChild(errorDiv);
    }

    // For an image, `_repr_mime_` returns the base64 data, or a (data, metadata)
    // tuple when the bundle carried metadata (e.g. retina images). Unwrap the
    // tuple and read out the size hints.
    const reprMime = async (
      item: PyProxy,
      mime: string
    ): Promise<{ data: any; metadata: Record<string, any> }> => {
      const result = await item._repr_mime_(mime);
      if (result && typeof result !== "string") {
        const data = await result.get(0);
        const meta = await result.get(1);
        const metadata = {
          width: await meta.get("width"),
          height: await meta.get("height"),
        };
        meta.destroy();
        result.destroy();
        return { data, metadata };
      }
      return { data: result, metadata: {} };
    };

    for (let i = 0; i < await result.outputs.length; i++) {
      const item = await result.outputs.get(i);
      const imagebitmap = await item._repr_mime_("application/html-imagebitmap");
      const html = await item._repr_mime_("text/html");
      const widget = await item._repr_mime_("application/vnd.jupyter.widget-view+json");
      const plotly = await item._repr_mime_("application/vnd.plotly.v1+json");
      const plain = await item._repr_mime_("text/plain");
      const png = await reprMime(item, "image/png");
      const jpeg = await reprMime(item, "image/jpeg");
      const gif = await reprMime(item, "image/gif");
      const svg = await item._repr_mime_("image/svg+xml");
      if (imagebitmap) {
        appendImageBitmap(imagebitmap);
      } else if (html) {
        appendHtml(html);
      } else if (widget) {
        appendJupyterWidget(widget);
      } else if (plotly) {
        appendPlotlyFigure(plotly);
      } else if (png.data) {
        appendDataUrlImage("image/png", png.data, png.metadata);
      } else if (jpeg.data) {
        appendDataUrlImage("image/jpeg", jpeg.data, jpeg.metadata);
      } else if (gif.data) {
        appendDataUrlImage("image/gif", gif.data, gif.metadata);
      } else if (svg) {
        appendHtml(svg);
      } else if (plain) {
        appendPlainText(plain);
      }
      // TODO: Support more types in the IPython.display module
      item.destroy();
    }

    // Attach final result to output value
    container.value.result = result;
    return container;
  }
}
