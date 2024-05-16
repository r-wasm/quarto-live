import type { WebR, Shelter, RObject, RList, RNull, REnvironment } from 'webr'
import { isRList } from 'webr';
import { highlightR } from './highlighter'
import { renderHtmlDependency } from './render'

declare global {
  interface Window {
    HTMLWidgets?: {
      staticRender: () => {};
    }
  }
}

type EvaluateOptions = {
  envir: REnvironment,
  caption: string,
  eval: boolean,
  echo: boolean,
  warning: boolean,
  error: boolean,
  include: boolean,
  output: boolean,
  timelimit: number,
  running: () => void,
  idle: () => void,
}

// Build interleaved source code and HTML output
// Use {evaluate}, so as to match {knitr} output
export class WebREvaluator {
  output: HTMLDivElement;
  sourceLines: string[];
  webR: WebR;
  shelter: Promise<Shelter>;
  options: EvaluateOptions;

  constructor(webR: WebR, options = {}) {
    this.output = document.createElement('div');
    this.sourceLines = [];
    this.webR = webR;
    this.shelter = new webR.Shelter();

    // Fallback default options
    this.options = Object.assign(
      {
        envir: webR.objs.globalEnv,
        eval: true,
        echo: true,
        warning: true,
        error: true,
        include: true,
        output: true,
        timelimit: 30,
        caption: 'Code',
        running: () => { },
        idle: () => { },
      },
      options
    );
  }

  async purge() {
    const shelter = await this.shelter;
    shelter.purge();
  }

  async evaluate(code) {
    // Early returns if we're not actually evaluating
    if (!code || code === '' || !this.options.include) {
      return;
    }

    if (!this.options.eval) {
      this.sourceLines.push(code);
      this.appendSource();
      return;
    }

    this.options.running();
    const shelter = await this.shelter;
    const capture = await shelter.captureR(`
      setTimeLimit(elapsed = timelimit, transient = TRUE)
      evaluate::evaluate(
          code,
          envir = envir,
          keep_message = warning,
          keep_warning = warning,
          stop_on_error = error,
          output_handler = evaluate::new_output_handler(
            value = function(x) {
              res <- withVisible(knitr::knit_print(x, options = list(screenshot.force = FALSE)))
              if (res$visible) res$value else invisible(res$value)
            }
          )
        )
      `,
      {
        env: {
          code,
          timelimit: Number(this.options.timelimit),
          envir: this.options.envir,
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
          if (classes.includes('knit_asis')) {
            await this.appendHtml(result[i]);
          } else {
            this.appendStdout(await result[i].toString());
          }
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
    this.options.idle();
  }

  appendSource() {
    if (this.options.echo && this.sourceLines.length) {
      const sourceDiv = document.createElement("div");
      const sourcePre = document.createElement("pre");
      sourceDiv.className = "sourceCode";
      sourcePre.className = "sourceCode r";
      const sourceCode = highlightR(this.sourceLines.join(''));
      sourceCode.className = "sourceCode r";
      sourcePre.appendChild(sourceCode);
      sourceDiv.appendChild(sourcePre);
      this.output.appendChild(sourceDiv);
    }
    this.sourceLines.length = 0;
  }

  appendStdout(content: string) {
    const outputDiv = document.createElement("div");
    outputDiv.className = "cell-output cell-output-stdout";
    outputDiv.innerHTML = `<pre><code>${content}</code></pre>`;

    if (this.options.output) {
      this.appendSource();
      this.output.appendChild(outputDiv);
    }
  }

  appendStderr(content: string) {
    const outputDiv = document.createElement("div");
    outputDiv.className = "cell-output cell-output-stderr";
    outputDiv.innerHTML = `<pre><code>${content}</code></pre>`;

    if (this.options.output) {
      this.appendSource();
      this.output.appendChild(outputDiv);
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
      this.output.appendChild(outputDiv);

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
      this.output.appendChild(outputDiv);
    }
  }
}
