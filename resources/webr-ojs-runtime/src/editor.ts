import type { OJSElement } from './evaluate';
import { basicSetup } from 'codemirror'
import { EditorView, ViewUpdate } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags } from "@lezer/highlight"
import { r } from 'codemirror-lang-r'

type EditorOptions = {
  autorun: boolean;
  caption: string;
  exercise: string;
  startover: boolean;
  container?: OJSElement;
}

type ExerciseButtonSpec = {
  text: string;
  icon: string;
  className: string;
  onclick?: ((ev: MouseEvent) => any);
}

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
  options: EditorOptions;
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

  constructor(code: string, options: EditorOptions) {
    if (typeof code !== "string") {
      throw new Error("Can't create editor, `code` must be a string.");
    }

    this.options = options;
    this.options.container = this.container = document.createElement("div");
    this.code = this.initialCode = code;
    this.state = EditorState.create({
      doc: code,
      extensions: [
        basicSetup,
        syntaxHighlighting(highlightStyle),
        this.reactiveViewof,
        r(),
      ],
    });

    this.view = new EditorView({
      state: this.state,
    });

    const dom = this.render();
    this.container.appendChild(dom);
    this.container.value = {
      code: this.options.autorun ? code : null,
      options: this.options,
    };

    // Prevent input Event when code autorun is disabled
    this.container.oninput = ((ev: CustomEvent) => {
      if (ev.detail.manual || this.options.autorun) {
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }) as EventListener;
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
    dom.className = "exercise-editor-eval-indicator d-none spinner-grow spinner-grow-sm";
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
        onclick: function() {
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
        onclick: function() {
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

          // Set blank output if code is run manually
          if (!this.options.autorun) {
            this.container.value.code = undefined;
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
    if (!this.options.autorun) {
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

    if (false) {
      rightButtons.push(
        this.renderButton({
          text: "Submit Answer",
          icon: "lightbulb",
          className: "btn-primary"
        }),
      );
    }

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
