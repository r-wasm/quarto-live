import type { WebR, RFunction } from 'webr'
import type { OJSElement, EvaluateOptions } from './evaluate';
import { basicSetup } from 'codemirror'
import { EditorView, ViewUpdate, keymap } from '@codemirror/view'
import { EditorState, Compartment, Prec } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { autocompletion, CompletionContext } from '@codemirror/autocomplete';
import { tags } from "@lezer/highlight"
import { r } from 'codemirror-lang-r'

type ExerciseOptions = EvaluateOptions & {
  autorun: boolean;
  caption: string;
  completion: boolean;
  runbutton: boolean;
  startover: boolean;
}

type ExerciseButtonSpec = {
  text: string;
  icon: string;
  className: string;
  onclick?: ((ev: MouseEvent) => any);
}

type ExerciseCompletionMethods = {
  assignLineBuffer: RFunction;
  assignToken: RFunction;
  assignStart: RFunction;
  assignEnd: RFunction;
  completeToken: RFunction;
  retrieveCompletions: RFunction;
};

type ExerciseButton = HTMLButtonElement | HTMLAnchorElement;

const icons = {
  'arrow-repeat': require('./assets/arrow-repeat.svg') as string,
  'exclamation-circle': require('./assets/exclamation-circle.svg') as string,
  lightbulb: require('./assets/lightbulb.svg') as string,
  play: require('./assets/play.svg') as string,
}

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--exercise-editor-hl-kw)" },
  { tag: tags.operator, color: "var(--exercise-editor-hl-op)" },
  { tag: tags.definitionOperator, color: "var(--exercise-editor-hl-ot)" },
  { tag: tags.compareOperator, color: "var(--exercise-editor-hl-sc)" },
  { tag: tags.attributeName, color: "var(--exercise-editor-hl-at)" },
  { tag: tags.controlKeyword, color: "var(--exercise-editor-hl-cf)" },
  { tag: tags.comment, color: "var(--exercise-editor-hl-co)" },
  { tag: tags.string, color: "var(--exercise-editor-hl-st)" },
  { tag: tags.regexp, color: "var(--exercise-editor-hl-ss)" },
  { tag: tags.variableName, color: "var(--exercise-editor-hl-va)" },
  { tag: tags.bool, color: "var(--exercise-editor-hl-cn)" },
  { tag: tags.separator, color: "var(--exercise-editor-hl-cn)" },
  { tag: tags.literal, color: "var(--exercise-editor-hl-cn)" },
  { tag: [tags.number, tags.integer], color: "var(--exercise-editor-hl-dv)" },
  { tag: tags.function(tags.variableName), color: "var(--exercise-editor-hl-fu)" },
  { tag: tags.function(tags.attributeName), color: "var(--exercise-editor-hl-at)" },
]);

export class ExerciseEditor {
  code: string
  initialCode: string
  state: EditorState;
  view: EditorView;
  container: OJSElement;
  options: ExerciseOptions;
  webRPromise: Promise<WebR>;
  completionMethods: Promise<ExerciseCompletionMethods>;
  reactiveViewof = [
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (!update.docChanged) return;
      this.code = update.state.doc.toString();
      this.container.value.code = this.code;
      this.container.dispatchEvent(new CustomEvent('input', {
        detail: { manual: false }
      }));
    }),
  ];

  constructor(webRPromise: Promise<WebR>, code: string, options: ExerciseOptions) {
    if (typeof code !== "string") {
      throw new Error("Can't create editor, `code` must be a string.");
    }

    this.container = document.createElement("div");
    this.webRPromise = webRPromise;
    this.code = this.initialCode = code;

    // Default editor options
    this.options = Object.assign({
      autorun: true,
      caption: 'Code',
      completion: true,
      runbutton: true,
      startover: true,
    }, options);

    const language = new Compartment();
    const tabSize = new Compartment();
    const extensions = [
      basicSetup,
      syntaxHighlighting(highlightStyle),
      language.of(r()),
      tabSize.of(EditorState.tabSize.of(2)),
      Prec.high(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              this.container.value.code = this.code;
              this.container.dispatchEvent(new CustomEvent('input', {
                detail: { manual: true }
              }));
              return true;
            },
          },
          {
            key: 'Mod-Shift-m',
            run: () => {
              this.view.dispatch({
                changes: {
                  from: 0,
                  to: this.view.state.doc.length,
                  insert: this.code.trimEnd() + " |> ",
                }
              });
              return true;
            },
          },
        ]
        )),
      this.reactiveViewof,
    ];

    if (options.completion) {
      this.completionMethods = this.setupCompletion();
      extensions.push(
        autocompletion({ override: [(...args) => this.doCompletion(...args)] })
      );
    }

    this.state = EditorState.create({
      doc: code,
      extensions,
    });

    this.view = new EditorView({
      state: this.state,
    });

    const dom = this.render();
    this.container.appendChild(dom);
    this.container.value = {
      code: this.options.autorun ? code : null,
      options: this.options,
      editor: this.container,
    };

    // Prevent input Event when run button is enabled
    this.container.oninput = ((ev: CustomEvent) => {
      if (this.options.runbutton && !ev.detail.manual) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    }) as EventListener;
  }

  async setupCompletion(): Promise<ExerciseCompletionMethods> {
    const webR = await this.webRPromise;
    await webR.evalRVoid('rc.settings(func=TRUE, fuzzy=TRUE)');
    return {
      assignLineBuffer: await webR.evalR('utils:::.assignLinebuffer') as RFunction,
      assignToken: await webR.evalR('utils:::.assignToken') as RFunction,
      assignStart: await webR.evalR('utils:::.assignStart') as RFunction,
      assignEnd: await webR.evalR('utils:::.assignEnd') as RFunction,
      completeToken: await webR.evalR('utils:::.completeToken') as RFunction,
      retrieveCompletions: await webR.evalR('utils:::.retrieveCompletions') as RFunction,
    };
  }

  async doCompletion(context: CompletionContext) {
    const completionMethods = await this.completionMethods;
    const line = context.state.doc.lineAt(context.state.selection.main.head).text;
    const { from, to, text } = context.matchBefore(/[a-zA-Z0-9_.:]*/) ?? { from: 0, to: 0, text: '' };
    if (from === to && !context.explicit) {
      return null;
    }
    await completionMethods.assignLineBuffer(line);
    await completionMethods.assignToken(text);
    await completionMethods.assignStart(from + 1);
    await completionMethods.assignEnd(to + 1);
    await completionMethods.completeToken();
    const compl = await completionMethods.retrieveCompletions() as { values: string[] };
    const options = compl.values.map((val) => {
      if (!val) {
        throw new Error('Missing values in completion result.');
      }
      return { label: val, boost: val.endsWith("=") ? 10 : 0 };
    });

    return { from, options };
  }

  renderButton(spec: ExerciseButtonSpec) {
    const dom = document.createElement("a");
    const label = document.createElement("span");
    dom.className = `d-flex align-items-center gap-1 btn btn-exercise-editor ${spec.className} text-nowrap`;
    label.innerText = spec.text;
    dom.innerHTML = icons[spec.icon];
    dom.appendChild(label);
    dom.onclick = spec.onclick || null;
    return dom;
  }

  renderButtonGroup(buttons: ExerciseButton[]) {
    const group = document.createElement("div");
    group.className = "btn-group btn-group-exercise-editor btn-group-sm";
    buttons.forEach((spec) => group.appendChild(spec));
    return group;
  }

  renderSpinner() {
    const dom = document.createElement("div");
    dom.className = "exercise-editor-eval-indicator spinner-grow spinner-grow-sm";
    dom.setAttribute("role", "status");
    return dom;
  }

  renderHints(): ExerciseButton | null {
    const hints = document.querySelectorAll(
      `.d-none.exercise-hint[data-exercise="${this.options.exercise}"]`
    );
    const solutions = document.querySelectorAll(
      `.d-none.exercise-solution[data-exercise="${this.options.exercise}"]`
    );

    // Reveal hints and solution in order of appearance in DOM
    // If there is a solution, terminate with a solution button
    let terminal: ExerciseButton | undefined;
    if (solutions.length > 0) {
      terminal = this.renderButton({
        text: "Show Solution",
        icon: "exclamation-circle",
        className: "btn-outline-dark",
        onclick: function () {
          Array.from(solutions).forEach((solution) => {
            solution.classList.remove("d-none");
          });
          this.remove();
        }
      });
    }

    // Next reduce over the hints, replacing each in a chain of click handlers
    return Array.from(hints).reduceRight<ExerciseButton | null>((current, hint) => {
      return this.renderButton({
        text: "Show Hint",
        icon: "lightbulb",
        className: "btn-outline-dark",
        onclick: function () {
          hint.classList.remove("d-none");
          if (current) {
            this.replaceWith(current);
          } else {
            this.remove();
          }
        }
      });
    }, terminal);
  }

  render() {
    const card = document.createElement("div");
    const header = document.createElement("div");
    const body = document.createElement("div");
    card.className = "card exercise-editor-card my-3";
    header.className = "card-header exercise-editor-header d-flex justify-content-between";
    body.className = "card-body exercise-editor-body p-0";

    const left = document.createElement("div");
    left.className = "d-flex align-items-center gap-3";
    const label = document.createElement("div");
    label.innerHTML = this.options.caption;
    left.appendChild(label);

    const leftButtons: ExerciseButton[] = [];
    if (this.options.startover) {
      leftButtons.push(this.renderButton({
        text: "Start Over",
        icon: "arrow-repeat",
        className: "btn-outline-dark",
        onclick: () => {
          // Reset code block contents to initial value
          this.view.dispatch({
            changes: {
              from: 0,
              to: this.view.state.doc.length,
              insert: this.initialCode,
            }
          });

          // Reset output if code is run manually
          if (this.options.runbutton) {
            this.container.value.code = null;
            if (this.options.autorun) {
              this.container.value.code = this.initialCode;
            }
            this.container.dispatchEvent(new CustomEvent('input', {
              detail: { manual: true }
            }));
          }
        }
      }));
    }

    const hintsButton = this.renderHints();
    if (hintsButton) leftButtons.push(hintsButton);

    if (leftButtons.length > 0) {
      left.appendChild(this.renderButtonGroup(leftButtons));
    }
    header.appendChild(left);

    let right = document.createElement("div");
    right.className = "d-flex align-items-center gap-3";

    const rightButtons: ExerciseButton[] = [];
    if (this.options.runbutton) {
      rightButtons.push(this.renderButton({
        text: "Run Code",
        icon: "play",
        className: "btn-primary disabled exercise-editor-btn-run-code",
        onclick: () => {
          this.container.value.code = this.code;
          this.container.dispatchEvent(new CustomEvent('input', {
            detail: { manual: true }
          }));
        }
      }));
    }

    right.appendChild(this.renderSpinner());

    if (rightButtons.length > 0) {
      right.appendChild(this.renderButtonGroup(rightButtons));
    }

    header.appendChild(right);
    card.appendChild(header);

    body.appendChild(this.view.dom);
    card.appendChild(body);
    return card;
  }
}
