import { WebREnvironmentManager } from './environment';
import { Indicator } from './indicator';
import { highlightR } from './highlighter';
import { renderHtmlDependency } from './render';
import { isRList, isRObject, isRFunction, isRCall, isRNull } from 'webr';
import type {
  RCall,
  RCharacter,
  RDouble,
  REnvironment,
  RInteger,
  RList,
  RLogical,
  RNull,
  RObject,
  RRaw,
  Shelter,
  WebR,
} from 'webr';
import {
  EnvLabel,
  EnvLabels,
  EvaluateContext,
  EvaluateOptions,
  ExerciseEvaluator,
  OJSElement
} from "./evaluate";

declare global {
  interface Window {
    HTMLWidgets?: {
      staticRender: () => {};
    }
    _ojs: {
      ojsConnector: any;
    }
  }
}


export class WebREvaluator implements ExerciseEvaluator {
  container: OJSElement;
  shelter: Promise<Shelter>;
  context: EvaluateContext;
  options: EvaluateOptions;
  envLabels: EnvLabels;
  envManager: WebREnvironmentManager;
  webR: WebR;

  constructor(webR: WebR, environmentManager: WebREnvironmentManager, context: EvaluateContext) {
    this.container = document.createElement('div');
    this.container.value = { result: null, evaluator: this };
    this.webR = webR;
    this.context = context;
    this.shelter = new webR.Shelter();

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

  async purge() {
    const shelter = await this.shelter;
    shelter.purge();
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
      const block = JSON.parse(atob(setup[0].textContent));
      return block.code;
    }
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
          await prep.bind(k, v);
        })
      );

      // Run setup code, copy prep environment for result, run user code
      const setup = this.getSetupCode();
      await this.evaluate(setup, "prep");
      await this.envManager.create(this.envLabels.result, this.envLabels.prep);
      const result = await this.evaluate(this.context.code, "result");

      // Once we have the evaluate result, render it's contents to HTML
      if (isRNull(result) || !this.options.output) {
        this.container.value.result = null;
      } else if (this.options.output === "asis") {
        const evaluateList = await result.toArray() as RObject[];
        const lastValue = await evaluateList[evaluateList.length - 1].get('value');
        this.container.innerHTML = await lastValue.toString();
      } else {
        this.container = await this.asHtml(result);
      }

      // Grab objects from the webR OJS environment
      const envir = await this.envManager.get(this.envLabels.result);
      const ojs_envir = await this.webR.objs.globalEnv.get('.webr_ojs') as REnvironment;
      const objs = await ojs_envir.toObject({ depth: -1 });

      // Grab defined objects from the result environment
      if (typeof this.options.define === 'string') {
        objs[this.options.define] = await envir.get(this.options.define);
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

      // Clean up OJS values from R environment
      await this.webR.evalRVoid("rm(list = ls(.webr_ojs), envir = .webr_ojs)");
    } finally {
      this.purge();
      ind.finished();
      if (!this.context.indicator) ind.destroy();
    }
  }

  async evaluate(code: string, envLabel: EnvLabel, options: EvaluateOptions = this.options) {
    // Early return if code is undefined, null, or if we're not evaluating
    if (code == null || !options.include) {
      return this.webR.objs.null;
    }

    const shelter = await this.shelter;
    // TODO: Extract this into a formal R function
    // TODO: There are a few of these now in src/scripts/R/setup.R,
    // it should be an R package loaded into the VFS at runtime instead.
    // TODO: collapse low-level plotting changes (e.g. abline(0, 1))
    const capture = await shelter.captureR(`
        setTimeLimit(elapsed = timelimit)
        on.exit(setTimeLimit(elapsed = Inf))
        evaluate::evaluate(
          code,
          envir = envir,
          keep_message = warning,
          keep_warning = warning,
          stop_on_error = error,
          filename = "User code",
          output_handler = getOption("webr.evaluate.handler")
        )
      `,
      {
        env: {
          code,
          timelimit: Number(options.timelimit),
          envir: await this.envManager.get(this.envLabels[envLabel]),
          warning: options.warning,
          error: options.error ? 0 : 1,
        }
      }
    );
    return capture.result as RList;
  }

  asSourceHTML(code): HTMLDivElement {
    const sourceDiv = document.createElement("div");
    const sourcePre = document.createElement("pre");
    sourceDiv.className = "sourceCode";
    sourcePre.className = "sourceCode r";
    const sourceCode = highlightR(code);
    sourcePre.appendChild(sourceCode);
    sourceDiv.appendChild(sourcePre);
    return sourceDiv;
  }

  async asHtml(value: RList, options: EvaluateOptions = this.options) {
    const sourceLines: string[] = [];
    const container: OJSElement = document.createElement("div");
    container.value = { result: null, evaluator: this };

    const appendSource = () => {
      if (options.echo && sourceLines.length) {
        const sourceDiv = document.createElement("div");
        const sourcePre = document.createElement("pre");
        sourceDiv.className = "sourceCode";
        sourcePre.className = "sourceCode r";
        const sourceCode = highlightR(sourceLines.join(''));
        sourcePre.appendChild(sourceCode);
        sourceDiv.appendChild(sourcePre);
        container.appendChild(sourceDiv);
      }
      sourceLines.length = 0;
    }

    const appendStdout = (content: string) => {
      const outputDiv = document.createElement("div");
      outputDiv.className = "exercise-cell-output cell-output cell-output-webr cell-output-stdout";
      outputDiv.innerHTML = `<pre><code>${content}</code></pre>`;

      if (options.output) {
        appendSource();
        container.appendChild(outputDiv);
      }
    }

    const appendStderr = (content: string) => {
      const outputDiv = document.createElement("div");
      outputDiv.className = "exercise-cell-output cell-output cell-output-webr cell-output-stderr";
      outputDiv.innerHTML = `<pre><code>${content}</code></pre>`;

      if (options.output) {
        appendSource();
        container.appendChild(outputDiv);
      }
    }

    const appendImage = (image: ImageBitmap) => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.className = "img-fluid figure-img";
      canvas.style.width = `${2 * image.width / 3}px`;
      canvas.getContext('bitmaprenderer').transferFromImageBitmap(image);

      const outputDiv = document.createElement("div");
      outputDiv.className = "cell-output-display cell-output-webr";
      outputDiv.appendChild(canvas);

      if (options.output) {
        appendSource();
        container.appendChild(outputDiv);
      }
    }

    // Handle base R and rlang conditions
    const appendCondition = async (cnd: RObject, type: string, heading: string) => {
      if (options.output) {
        appendSource();

        // Format the condition for printing
        const formatted = await shelter.evalR("format(cnd, backtrace = FALSE)", {
          env: { cnd },
        });
        const names = await formatted.names();

        let body = "";
        let callInfo = "";
        if (names && names.includes("message")) {
          // This is likely a standard R condition
          const message = await cnd.get("message");
          const call = await cnd.get("call") as RCall;
          callInfo = await call.type() === "null" ? ': ' : ` in \`${await call.deparse()}\``;
          body = `${heading}: ${await message.toString()}`;
        } else {
          // This is likely an rlang condition
          body = await formatted.toString();
        }

        // Output condition as a callout block, similar to OJS errors
        const elem = document.createElement("div");
        elem.innerHTML = `
        <div class="callout-${type} callout callout-style-default callout-captioned">
          <div class="callout-header d-flex align-content-center">
            <div class="callout-icon-container"><i class="callout-icon"></i></div>
            <div class="callout-caption-container flex-fill">R ${heading}${callInfo}</div>
          </div>
          <div class="callout-body-container callout-body">
            <pre></pre>
          </div>
        </div>
        `;
        elem.querySelector(".callout-body pre").appendChild(document.createTextNode(body));
        container.appendChild(elem);
      }
    }

    const appendHtml = async (content: RObject) => {
      if (options.output) {
        const html = await content.toString();
        const meta = await (await content.attrs()).get("knit_meta") as RList | RNull;

        const outputDiv = document.createElement("div");
        outputDiv.className = "cell-output cell-output-webr";
        outputDiv.innerHTML = html;

        // Add HTML output to the DOM
        appendSource();
        container.appendChild(outputDiv);

        // Dynamically load any dependencies into page (await & maintain ordering)
        if (isRList(meta)) {
          const deps = await meta.toArray();
          for (let i = 0; i < deps.length; i++) {
            await renderHtmlDependency(this.webR, deps[i] as RObject);
          }
        }
      }
    };

    const shelter = await this.shelter;
    const result = await value.toArray() as RObject[];
    for (let i = 0; i < result.length; i++) {
      const type = await result[i].type();
      const classes = await (await result[i].class()).toArray();
      switch (type) {
        case 'character': {
          appendStdout(await result[i].toString());
          break;
        }
        case 'list': {
          if (classes.includes('warning')) {
            await appendCondition(result[i], "warning", "Warning");
          } else if (classes.includes('error')) {
            await appendCondition(result[i], "important", "Error");
          } else if (classes.includes('condition')) {
            const message = await result[i].get("message");
            appendStderr(await message.toString());
          }

          // Source code - save for concatenation
          if (classes.includes('source')) {
            const src = await result[i].get("src");
            sourceLines.push(await src.toString());
          }

          // Print visible knit_asis results
          if (classes.includes('result')) {
            const visible = await (await result[i].get("visible") as RLogical).toBoolean();
            const value = await result[i].get("value");
            const classes = await (await value.class()).toArray();
            if (visible && classes.includes("knit_asis")) {
              await appendHtml(value);
            }
          }

          // Plot image
          if (classes.includes('recordedplot')) {
            let width = await this.webR.evalRNumber('72 * getOption("webr.fig.width")');
            if ("fig-width" in this.options) {
              width = Number(this.options["fig-width"]);
            }
            let height = await this.webR.evalRNumber('72 * getOption("webr.fig.height")');
            if ("fig-height" in this.options) {
              height = Number(this.options["fig-height"]);
            }

            const capturePlot = await shelter.captureR("replayPlot(plot)", {
              captureGraphics: { width, height },
              env: { plot: result[i] },
            });
            appendImage(capturePlot.images[0]);
          }
          break;
        }
        default:
          throw new Error(`Unexpected list item type "${type}" in evaluation result`);
      }
    }
    appendSource();

    // Attach final result to output value
    container.value.result = await result[result.length - 1].get('value');
    container.value.evaluate_result = value;
    return container;
  }

  // Convert webR R object reference to OJS value
  async asOjs(value: ImageBitmap): Promise<OJSElement>;
  async asOjs(value: any): Promise<any>;
  async asOjs(value) {
    if (value instanceof ImageBitmap) {
      const canvas = document.createElement("canvas");
      canvas.width = value.width;
      canvas.height = value.height
      const ctx = canvas.getContext("2d");
      ctx.drawImage(value, 0, 0, value.width, value.height);
      value.close();
      canvas.style.width = `${2 * ctx.canvas.width / 3}px`;
      return canvas;
    }

    if (!isRObject(value)) {
      return value;
    }

    // We have an R object, so grab knitr output to support asis, e.g. HTML.
    const shelter = await this.shelter;
    const capture = await shelter.captureR(`
      knitr::knit_print(value, options = list(screenshot.force = FALSE))
    `, { env: { value } });
    const robj = capture.result;

    if (isRFunction(robj) || isRCall(robj)) {
      // If there are images, return the final captured plot back to OJS.
      // Otherwise, return the captured R result value.
      // TODO: Handle returning result and (multiple) plots to OJS
      return async (...args) => {
        try {
          const width = await this.webR.evalRNumber('72 * getOption("webr.fig.width")');
          const height = await this.webR.evalRNumber('72 * getOption("webr.fig.height")');
          const capture = await robj.capture(
            {
              withAutoprint: true,
              captureGraphics: { width, height },
            },
            ...args
          );
          if (capture.images.length) {
            const el = await this.asOjs(capture.images[capture.images.length - 1]);
            el.value = await this.asOjs(capture.result);
            return el;
          }
          return await this.asOjs(capture.result);
        } finally {
          this.webR.globalShelter.purge();
        }
      };
    }

    switch (robj._payload.obj.type) {
      // TODO: "symbol"
      case "null":
        return null;

      case "character": {
        const classes = await (await robj.class()).toArray();
        if (classes.includes('knit_asis')) {
          const html = await robj.toString();
          const meta = await (await robj.attrs()).get("knit_meta") as RList | RNull;
  
          const outputDiv = document.createElement("div");
          outputDiv.className = "cell-output";
          outputDiv.innerHTML = html;
  
          // Dynamically load any dependencies into page (await & maintain ordering)
          if (isRList(meta)) {
            const deps = await meta.toArray();
            for (let i = 0; i < deps.length; i++) {
              await renderHtmlDependency(this.webR, deps[i] as RObject);
            }
          }
          if (window.HTMLWidgets) {
            setTimeout(() => {
              window.HTMLWidgets.staticRender();
            }, 250);
          }
          return outputDiv;
        }
      }
      case "logical":
      case "double":
      case "raw":
      case "integer": {
        const rVector = robj as RLogical | RDouble | RRaw | RInteger;
        return await rVector.toArray();
      }

      case "list": {
        // Convert a `data.frame` to D3 format, otherwise fall through.
        const attrs = await robj.attrs();
        const cls = await attrs.get('class') as RCharacter;
        if (!isRNull(cls) && (await cls.toArray()).includes('data.frame')) {
          return await (robj as RList).toD3();
        }
      }
      case "environment":
      case "pairlist": {
        const result = {};
        const shallow = await robj.toJs({ depth: -1 }) as { names: string[]; values: any[] };
        for (let i = 0; i < shallow.values.length; i++) {
          const key = shallow.names ? shallow.names[i] : i;
          result[key] = await this.asOjs(shallow.values[i]);
        }
        return result;
      };

      default:
        throw new Error(`Unsupported type: ${value._payload.obj.type}`);
    }
  }
}
