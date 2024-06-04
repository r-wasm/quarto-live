import type { WebR, Shelter, RObject, RList, RNull, REnvironment} from 'webr'
import type { RCharacter, RLogical, RDouble, RRaw, RInteger } from 'webr'
import { isRList, isRObject, isRFunction, isRCall, isRNull } from 'webr';
import { highlightR } from './highlighter'
import { renderHtmlDependency } from './render'
import { ExerciseOptions } from './editor';
import { EnvironmentManager } from './environment';

export type OJSElement = HTMLElement & { value?: any };

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

export interface EvaluatorContext {
  code: string,
  options: ExerciseOptions,
  editor?: OJSElement,
};

// Build interleaved source code and HTML output
// Use {evaluate}, so as to match {knitr} output
interface ExerciseEvaluator {
  evaluate(code: string);
  evaluateQuietly(code: string);
  asOjs(value: any): Promise<any>;
  container: OJSElement;
}

export class WebREvaluator implements ExerciseEvaluator {
  private sourceLines: string[] = [];
  container: OJSElement;
  shelter: Promise<Shelter>;
  context: EvaluatorContext;
  options: ExerciseOptions;
  envir: {
    active: Promise<REnvironment>;
  }
  webR: WebR;

  constructor(webR: WebR, environmentManager: EnvironmentManager, context: EvaluatorContext) {
    this.container = document.createElement('div');
    this.container.value = null;
    this.webR = webR;
    this.context = context;
    this.shelter = new webR.Shelter();

    // Default evaluation options
    this.options = Object.assign(
      {
        envir: "global",
        eval: true,
        echo: true,
        warning: true,
        error: true,
        include: true,
        output: true,
        timelimit: 30,
      },
      context.options
    );

    this.envir = {
      active: environmentManager.get(this.options.envir),
    }
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

    try{
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
              var container = document.createElement('div');
              container.innerHTML = await robj.toString();
              return container.firstElementChild;
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
    } finally {
      shelter.destroy(value);
    }
  }

  async purge() {
    const shelter = await this.shelter;
    shelter.purge();
  }

  async process(inputs: {[key: string]: any}) {
    // Set OJS inputs in R environment
    const envir = await this.envir.active;
    await Promise.all(
      Object.entries(inputs).map(async ([k, v]) => {
        await envir.bind(k, v);
      })
    );

    // Evaluate setup code (if exists), then current code
    try {
      await this.evaluateQuietly(this.options.setup);
      await this.evaluate(this.context.code);
    } finally {
      this.purge();
    }

    // Grab objects from the webR OJS environment
    const ojs_envir = await this.webR.objs.globalEnv.get('.webr_ojs') as REnvironment;
    const objs = await ojs_envir.toObject({ depth: -1 });

    // Grab objects from the evaluator environment
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
  }

  async evaluateQuietly(code) {
    if (!code || code === '') {
      this.setIdle();
      return;
    }
    this.setRunning();
    const shelter = await this.shelter;
    try {
      await shelter.evalR(`
        evaluate::evaluate(
          code,
          envir = envir,
          keep_message = warning,
          keep_warning = warning,
          stop_on_error = error
        )
      `,
        {
          env: {
            code,
            envir: await this.envir.active,
            warning: this.options.warning,
            error: this.options.error ? 0 : 1,
          }
        }
      );
    } finally {
      shelter.purge();
      this.setIdle();
    }
  }

  async evaluate(code) {
    // Early returns if we're not actually evaluating
    if (!code || code === '' || !this.options.include) {
      this.setIdle();
      return;
    }

    if (!this.options.eval) {
      this.sourceLines.push(code);
      this.appendSource();
      return;
    }

    this.setRunning();
    const shelter = await this.shelter;
    try {
      const capture = await shelter.captureR(`
          setTimeLimit(elapsed = timelimit)
          on.exit(setTimeLimit(elapsed = Inf))

          evaluate::evaluate(
            code,
            envir = envir,
            keep_message = warning,
            keep_warning = warning,
            stop_on_error = error,
            output_handler = evaluate::new_output_handler(
              value = function(x, visible) {
                res <- if (visible) {
                  withVisible(knitr::knit_print(x, options = list(screenshot.force = FALSE)))
                } else list(value = x, visible = FALSE)
                class(res) <- "result"
                res
              }
            )
          )
        `,
        {
          env: {
            code,
            timelimit: Number(this.options.timelimit),
            envir: await this.envir.active,
            warning: this.options.warning,
            error: this.options.error ? 0 : 1,
          }
        }
      );

      const result = await (capture.result as RList).toArray() as RObject[];
      for (let i = 0; i < result.length; i++) {
        const type = await result[i].type();
        const classes = await (await result[i].class()).toArray();
        switch (type) {
          case 'character': {
            this.appendStdout(await result[i].toString());
            break;
          }
          case 'list': {
            // Conditions
            if (classes.includes('warning')) {
              const message = await result[i].get("message");
              this.appendStderr(`Warning: ${await message.toString()}`);
            } else if (classes.includes('error')) {
              const message = await result[i].get("message");
              const call = await result[i].get("call");
              /* @ts-expect-error: deparse not available yet, next release of webR */
              const callInfo = await call.type() === "null" ? ': ' : ` in \`${await call.deparse()}\`: `;
              this.appendStderr(`Error${callInfo}${await message.toString()}`);
            } else if (classes.includes('condition')) {
              const message = await result[i].get("message");
              this.appendStderr(await message.toString());
            }

            // Source code - save for concatenation
            if (classes.includes('source')) {
              const src = await result[i].get("src");
              this.sourceLines.push(await src.toString());
            }

            // Print visible knit_asis results
            if (classes.includes('result')) {
              const visible = await (await result[i].get("visible") as RLogical).toBoolean();
              const value = await result[i].get("value");
              const classes = await (await value.class()).toArray();
              if (visible && classes.includes("knit_asis")) {
                await this.appendHtml(value);
              }
            }

            // Plot image
            if (classes.includes('recordedplot')) {
              const width = await this.webR.evalRNumber('72 * getOption("webr.fig.width")');
              const height = await this.webR.evalRNumber('72 * getOption("webr.fig.height")');
              const capturePlot = await shelter.captureR("replayPlot(plot)", {
                captureGraphics: { width, height },
                env: { plot: result[i] },
              });
              this.appendImage(capturePlot.images[0]);
            }
            break;
          }
          default:
            throw new Error(`Unexpected list item type "${type}" in evaluation result`);
        }
      }
      this.appendSource();

      // Attach final result to output value
      this.container.value = await result[result.length - 1].get('value');
    } finally {
      shelter.purge();
      this.setIdle();
    }
  }

  appendSource() {
    if (this.options.echo && this.sourceLines.length) {
      const sourceDiv = document.createElement("div");
      const sourcePre = document.createElement("pre");
      sourceDiv.className = "sourceCode";
      sourcePre.className = "sourceCode r";
      const sourceCode = highlightR(this.sourceLines.join(''));
      sourcePre.appendChild(sourceCode);
      sourceDiv.appendChild(sourcePre);
      this.container.appendChild(sourceDiv);
    }
    this.sourceLines.length = 0;
  }

  appendStdout(content: string) {
    const outputDiv = document.createElement("div");
    outputDiv.className = "exercise-cell-output cell-output cell-output-stdout";
    outputDiv.innerHTML = `<pre><code>${content}</code></pre>`;

    if (this.options.output) {
      this.appendSource();
      this.container.appendChild(outputDiv);
    }
  }

  appendStderr(content: string) {
    const outputDiv = document.createElement("div");
    outputDiv.className = "exercise-cell-output cell-output cell-output-stderr";
    outputDiv.innerHTML = `<pre><code>${content}</code></pre>`;

    if (this.options.output) {
      this.appendSource();
      this.container.appendChild(outputDiv);
    }
  }

  async appendHtml(content: RObject) {
    if (this.options.output) {
      const html = await content.toString();
      const meta = await (await content.attrs()).get("knit_meta") as RList | RNull;

      const outputDiv = document.createElement("div");
      outputDiv.className = "cell-output";
      outputDiv.innerHTML = html;

      // Add HTML output to the DOM
      this.appendSource();
      this.container.appendChild(outputDiv);

      // Dynamically load any dependencies into page (await & maintain ordering)
      if (isRList(meta)) {
        const deps = await meta.toArray();
        for (let i = 0; i < deps.length; i++) {
          await renderHtmlDependency(this.webR, deps[i] as RObject);
        }
      }
    }
  }

  appendImage(image: ImageBitmap) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.className = "img-fluid figure-img";
    canvas.style.width = `${2 * image.width / 3}px`;
    canvas.getContext('bitmaprenderer').transferFromImageBitmap(image);

    const outputDiv = document.createElement("div");
    outputDiv.className = "cell-output-display";
    outputDiv.appendChild(canvas);

    if (this.options.output) {
      this.appendSource();
      this.container.appendChild(outputDiv);
    }
  }

  setRunning() {
    if (this.context.editor) {
      Array.from(
        this.context.editor.getElementsByClassName('exercise-editor-eval-indicator')
      ).forEach((el) => el.classList.remove('d-none'));
    }
    Array.from(
      document.getElementsByClassName('exercise-editor-btn-run-code')
    ).forEach((el) => el.classList.add('disabled'));
  }

  setIdle() {
    Array.from(
      document.getElementsByClassName('exercise-editor-eval-indicator')
    ).forEach((el) => el.classList.add('d-none'));
    Array.from(
      document.getElementsByClassName('exercise-editor-btn-run-code')
    ).forEach((el) => el.classList.remove('disabled'));
  }
}
