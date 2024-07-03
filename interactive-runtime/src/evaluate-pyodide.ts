import { PyodideEnvironmentManager } from './environment';
import { Indicator } from './indicator';
import { highlightPython } from './highlighter';
import type { PyProxy } from 'pyodide/ffi';
import {
  EnvLabel,
  EnvLabels,
  EvaluateContext,
  EvaluateOptions,
  ExerciseEvaluator,
  OJSElement
} from "./evaluate";
import { PyodideInterfaceWorker } from './pyodide-worker';


declare global {
  interface Window {
    require: (
      (modules: string[], callback?: (...modules: any[]) => any) => any
    ) & {
      config: (options: { paths: { [key: string]: string } }) => void;
    };
    _ojs: {
      ojsConnector: any;
    }
  }
}

let stateElement: HTMLScriptElement | undefined;
const requireHtmlManager = {
  paths: {
    "@jupyter-widgets/html-manager/dist/libembed-amd":
      "https://cdn.jsdelivr.net/npm/@jupyter-widgets/html-manager@1.0.11/dist/libembed-amd"
  },
};

export class PyodideEvaluator implements ExerciseEvaluator {
  container: OJSElement;
  context: EvaluateContext;
  options: EvaluateOptions;
  envLabels: EnvLabels;
  envManager: PyodideEnvironmentManager;
  pyodide: PyodideInterfaceWorker;

  constructor(
    pyodide: PyodideInterfaceWorker,
    environmentManager: PyodideEnvironmentManager,
    context: EvaluateContext
  ) {
    this.container = document.createElement('div');
    this.container.value = { result: null, evaluator: this };
    this.pyodide = pyodide;
    this.context = context;

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

    if (!this.options.exercise || this.options.envir === "global") {
      this.envLabels = {
        prep: this.options.envir,
        result: this.options.envir,
        grading: this.options.envir,
        solution: this.options.envir,
      }
    } else {
      this.envLabels = {
        prep: `${this.options.envir}-prep`,
        result: `${this.options.envir}-result`,
        grading: `${this.options.envir}-grading`,
        solution: `${this.options.envir}-solution`,
      }
    }
    this.envManager = environmentManager;
  }

  // Setup environment, execute setup code, execute user code, define outputs
  async process(inputs: { [key: string]: any }) {
    // If we're not evaluating, just print the source directly
    if (!this.options.eval) {
      this.container = this.asSourceHTML(this.context.code);
      this.container.value = { result: null, evaluator: this };
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
      const prep = await this.envManager.get(this.envLabels.prep);
      await Promise.all(
        Object.entries(inputs).map(async ([k, v]) => {
          await prep.set(k, v);
        })
      );

      // Cleanup any leftover matplotlib plots
      await this.pyodide.runPythonAsync(`
        import matplotlib.pyplot as plt
        plt.close("all")
      `)

      // Run setup code, copy prep environment for result, run user code
      await this.evaluate(this.options.setup, "prep");
      await this.envManager.create(this.envLabels.result, this.envLabels.prep);
      const result = await this.evaluate(this.context.code, "result");

      // Once we have the evaluate result, render it's contents to HTML
      if (!this.options.output) {
        this.container.value.result = null;
      } else if (this.options.output === "asis") {
        this.container.innerHTML = await result.stdout;
      } else {
        this.container = await this.asHtml(result);
      }

      // Grab defined objects from the result environment
      const envir = await this.envManager.get(this.envLabels.result);
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
    // Early return if code is undefined, null, or if we're not evaluating
    if (code == null || !options.include) {
      return null;
    }

    await this.pyodide.loadPackagesFromImports(code);
    const locals = await this.pyodide.toPy({
      code,
      environment: await this.envManager.get(this.envLabels[envLabel]),
    });

    const resultObject = await this.pyodide.runPythonAsync(`
      from IPython.utils import capture
      from IPython.core.interactiveshell import InteractiveShell
      InteractiveShell().instance()
      import sys

      import pyodide
      with capture.capture_output() as output:
        value = None
        try:
          value = pyodide.code.eval_code(code, globals = environment)
        except Exception as err:
          print(err, file=sys.stderr)
        if (value is not None):
          display(value)

      {
        "value": value,
        "stdout": output.stdout,
        "stderr": output.stderr,
        "outputs": output.outputs,
      }
    `, { locals });
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
    const container: OJSElement = document.createElement("div");
    container.value = { result: null, evaluator: this };

    if (!result) {
      return container;
    }

    const appendImage = (image: ImageBitmap) => {
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
        window.require.config(requireHtmlManager);
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

      window.require(['@jupyter-widgets/html-manager/dist/libembed-amd'], function (m) {
        m.renderWidgets();
      });
    }

    const appendHtml = async (html: string) => {
      if (options.output) {
        const outputDiv = document.createElement("div");
        outputDiv.className = "cell-output cell-output-pyodide";
        outputDiv.innerHTML = html;
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

    if (result.stdout) {
      const outputDiv = document.createElement("div");
      outputDiv.className = "exercise-cell-output cell-output cell-output-pyodide cell-output-stdout";
      outputDiv.innerHTML = `<pre><code>${result.stdout}</code></pre>`;
      container.appendChild(outputDiv);
    }

    if (result.stderr) {
      const errorDiv = document.createElement("div");
      errorDiv.className = "exercise-cell-output cell-output cell-output-pyodide cell-output-stderr";
      errorDiv.innerHTML = `<pre><code>${result.stderr}</code></pre>`;
      container.appendChild(errorDiv);
    }

    for(let i = 0; i < await result.outputs.length; i++) {
      const item = await result.outputs.get(i);
      const imagebitmap = await item._repr_mime_("application/html-imagebitmap");
      const html = await item._repr_mime_("text/html");
      const widget = await item._repr_mime_("application/vnd.jupyter.widget-view+json");
      const plain = await item._repr_mime_("text/plain");
      if (imagebitmap) {
        appendImage(imagebitmap);
      } else if (html) {
        appendHtml(html);
      } else if (widget) {
        appendJupyterWidget(widget);
      } else if (plain) {
        appendPlainText(plain);
      }
      item.destroy();
    }

    // Attach final result to output value
    container.value.result = result;
    return container;
  }
}