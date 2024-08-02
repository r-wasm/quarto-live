import type { WebR, RFunction } from 'webr';
import type { PyodideInterface } from 'pyodide';
import type { EvaluateOptions } from './evaluate';
import { Indicator } from './indicator';
import { basicSetup } from 'codemirror';
import { tagHighlighterTok } from './highlighter';
import { EditorView, ViewUpdate, keymap } from '@codemirror/view';
import { EditorState, Compartment, Prec, Extension } from '@codemirror/state';
import { syntaxHighlighting } from "@codemirror/language";
import { autocompletion, CompletionContext } from '@codemirror/autocomplete';
import { python } from "@codemirror/lang-python";
import { r } from "codemirror-lang-r";

export type EditorValue = {
  code: string | null;
  options: ExerciseOptions;
  indicator?: Indicator;
}
export type OJSEditorElement = HTMLElement & { value?: EditorValue };

type ExerciseOptions = EvaluateOptions & {
  autorun: boolean;
  caption: string;
  completion: boolean;
  id: string,
  persist: boolean;
  runbutton: boolean;
  startover: boolean;
  'min-lines': number | undefined;
  'max-lines': number | undefined;
}

type ExerciseButtonSpec = {
  text: string;
  icon: string;
  className: string;
  onclick?: ((ev: Event) => any);
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

// TODO: This should be made optional, or perhaps a less heavy handed approach.
function hideEmptyPanels() {
  // Look for tabset panels and hide any with no content
  const panels = document.querySelectorAll('.tab-content > .tab-pane');
  Array.from(panels).forEach((panel) => {
    if (panel.innerHTML.trim() == '') {
      panel.classList.add("d-none");
      const nav = document.querySelector(`.nav-item > a[data-bs-target="#${panel.id}"]`);
      nav?.parentElement?.classList.add("d-none");
    }
  });

  // Is this the only tabset panel left? If so, drop the entire tabset container
  const tabContents = document.querySelectorAll('.tab-content');
  Array.from(tabContents).forEach((tabContent) => {
    const numVisible = Array.from(tabContent.children)
      .reduce((acc, panel) => {
        return panel.classList.contains("d-none") ? acc : acc + 1;
      }, 0);
    if (numVisible == 1) {
      const visible = tabContent.querySelector('.tab-pane:not(.d-none)');
      const tabset = tabContent.parentElement;
      tabset.appendChild(visible);
      tabset.querySelector('.nav.nav-tabs').remove();
      tabContent.remove();
    }
  });
}

abstract class ExerciseEditor {
  abstract defaultCaption: string;
  storageKey: string;
  initialCode: string;
  state: EditorState;
  view: EditorView;
  container: OJSEditorElement;
  options: ExerciseOptions;
  indicator: Indicator;
  completionMethods: Promise<ExerciseCompletionMethods>;

  constructor(code: string, options: ExerciseOptions) {
    if (typeof code !== "string") {
      throw new Error("Can't create editor, `code` must be a string.");
    }

    this.container = document.createElement("div");
    this.initialCode = code;

    // Default editor options
    this.options = Object.assign({
      autorun: true,
      completion: true,
      runbutton: true,
      startover: true,
      persist: false,
    }, options);

    this.storageKey = `editor-${window.location.href}#${this.options.id}`;

    const extensions = [
      basicSetup,
      this.extensions(),
      EditorView.updateListener.of((update) => this.onViewUpdate(update)),
    ];

    if (options.completion) {
      extensions.push(
        autocompletion({ override: [(...args) => this.doCompletion(...args)] })
      );
    }

    // Load previous edits to editor from browser storage
    if (this.options.persist) {
      const storedCode = window.localStorage.getItem(this.storageKey);
      if (storedCode) {
        code = storedCode;
      }
    }

    this.state = EditorState.create({
      doc: code,
      extensions,
    });

    this.view = new EditorView({
      state: this.state,
    });

    const dom = this.render();

    // Set editor height restrictions
    const minLines = String(options['min-lines'] || 0);
    const maxLines = String(options['max-lines']) || "infinity";
    dom.style.setProperty('--exercise-min-lines', minLines);
    dom.style.setProperty('--exercise-max-lines', maxLines);

    this.container.oninput = (ev: CustomEvent) => this.onInput(ev);
    this.container.appendChild(dom);
    this.container.value = {
      code: this.options.autorun ? code : null,
      options: this.options,
    };

    // Evaluation indicators
    this.container.value.indicator = this.indicator = new Indicator({
      runningCallback: () => {
        Array.from(
          this.container.getElementsByClassName('exercise-editor-eval-indicator')
        ).forEach((el) => el.classList.remove('d-none'));
      },
      finishedCallback: () => {
        Array.from(
          this.container.getElementsByClassName('exercise-editor-eval-indicator')
        ).forEach((el) => el.classList.add('d-none'));
      },
      busyCallback: () => {
        Array.from(
          this.container.getElementsByClassName('exercise-editor-btn-run-code')
        ).forEach((el) => el.classList.add('disabled'));
      },
      idleCallback: () => {
        Array.from(
          this.container.getElementsByClassName('exercise-editor-btn-run-code')
        ).forEach((el) => el.classList.remove('disabled'));
      }
    });
  }

  extensions(): Extension[] {
    const language = new Compartment();
    const tabSize = new Compartment();
    return [
      syntaxHighlighting(tagHighlighterTok),
      language.of(r()),
      tabSize.of(EditorState.tabSize.of(2)),
      Prec.high(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              this.container.dispatchEvent(new CustomEvent('input', {
                detail: { commit: true }
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
                  insert: this.view.state.doc.toString().trimEnd() + " |> ",
                }
              });
              return true;
            },
          },
        ]
        )),
    ];
  }

  onInput(ev: CustomEvent) {
    // When using run button, prevent firing of reactive ojs updates until `manual: true`.
    if (this.options.runbutton && !ev.detail.commit) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      return;
    }

    // Update reactive value for code contents
    this.container.value.code = this.view.state.doc.toString();
    if ('code' in ev.detail) {
      this.container.value.code = ev.detail.code;
    }

    // Store latest updates to editor content to local browser storage
    if (this.options.persist) {
      window.localStorage.setItem(this.storageKey, this.container.value.code);
    }
  }

  onViewUpdate(update: ViewUpdate) {
    if (!update.docChanged) return;
    this.container.dispatchEvent(
      new CustomEvent('input', { detail: { commit: false } })
    );
  }

  abstract setupCompletion(): Promise<any>;
  abstract doCompletion(context: CompletionContext): Promise<any>;

  renderButton(spec: ExerciseButtonSpec) {
    // TODO: Fix: we use <a> because Quarto adds its own styling to <button>
    const dom = document.createElement("a");
    const label = document.createElement("span");
    dom.className = `d-flex align-items-center gap-1 btn btn-exercise-editor ${spec.className} text-nowrap`;
    dom.setAttribute("role", "button");
    dom.setAttribute("aria-label", spec.text);
    label.className = "btn-label-exercise-editor";
    label.innerText = spec.text;
    dom.innerHTML = icons[spec.icon];
    dom.appendChild(label);
    dom.onclick = spec.onclick || null;
    dom.onkeydown = spec.onclick || null;
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

  renderHintButton(hints: NodeListOf<Element>, initial: ExerciseButton | undefined) {
    // Reduce over the hints, replacing each in a chain of click handlers
    return Array.from(hints).reduceRight<ExerciseButton | null>(
      (current, hint, idx, arr) => {
        return this.renderButton({
          text: idx === 0 ? "Show Hint" : "Next Hint",
          icon: "lightbulb",
          className: "btn-outline-dark btn-sm",
          onclick: function () {
            if (idx > 0) arr[idx - 1].classList.add("d-none");
            hint.classList.remove("d-none");
            if (current) {
              this.replaceWith(current);
            } else {
              this.remove();
            }
          }
        }
        );
      }, initial);
  }

  renderSolutionButton(solutions: NodeListOf<Element>, hide: NodeListOf<Element>) {
    // Reveal all solution elements at once, optionally hiding other elements
    return this.renderButton({
      text: "Show Solution",
      icon: "exclamation-circle",
      className: "btn-exercise-solution btn-outline-dark btn-sm",
      onclick: function () {
        if (hide) hide.forEach((elem) => elem.classList.add('d-none'));
        Array.from(solutions).forEach((solution) => {
          solution.classList.remove("d-none");
        });
        this.remove();
      }
    });
  }

  renderHintsTabset(hints: NodeListOf<Element>, solutions: NodeListOf<Element>): null {
    // Return nothing but with a side effect:
    //   Add reveal buttons to the top of applicable tabset panes
    const hintPanels = new Set<Element>();
    hints.forEach((hint) => {
      const parent = hint.parentElement;
      if (parent.id.includes("tabset-")) {
        hintPanels.add(parent);
      }
    });

    const solutionPanels = new Set<Element>();
    solutions.forEach((solution) => {
      const parent = solution.parentElement;
      if (parent.id.includes("tabset-")) {
        solutionPanels.add(parent);
      }
    });

    hintPanels.forEach((panel) => {
      const header = document.createElement('div');
      header.className = "d-flex justify-content-between exercise-tab-pane-header";
      const innerHints = panel.querySelectorAll(
        `.exercise-hint[data-exercise="${this.options.exercise}"]`
      );
      header.appendChild(this.renderHintButton(innerHints, null));
      panel.prepend(header);
    })

    solutionPanels.forEach((panel) => {
      const header = document.createElement('div');
      header.className = "d-flex justify-content-between exercise-tab-pane-header";
      const innerSolutions = panel.querySelectorAll(
        `.exercise-solution[data-exercise="${this.options.exercise}"]`
      );
      header.appendChild(this.renderSolutionButton(innerSolutions, null));
      panel.prepend(header);
    })
    return null;
  }

  renderHints(): ExerciseButton | null {
    const hints = document.querySelectorAll(
      `.d-none.exercise-hint[data-exercise="${this.options.exercise}"]`
    );
    const solutions = document.querySelectorAll(
      `.d-none.exercise-solution[data-exercise="${this.options.exercise}"]`
    );

    const inTabPane = Array.from(hints).some((hint) =>
      hint.parentElement.id.includes('tabset-')
    ) || Array.from(solutions).some((sol) =>
      sol.parentElement.id.includes('tabset-')
    );

    let elem = null;
    if (inTabPane) {
      // Reveal hints and solutions contained in the associated tab-panels
      this.renderHintsTabset(hints, solutions);
    } else {
      // Reveal hints and solution in order of appearance in DOM
      // If there is a solution, terminate with a solution button
      let initial: ExerciseButton | undefined;
      if (solutions.length > 0) {
        initial = this.renderSolutionButton(solutions, hints);
      }
      elem = this.renderHintButton(hints, initial);
    }

    // Check for empty tabset panels and hide them
    // This can happen if we have set e.g. `show-solutions: false`
    hideEmptyPanels();
    return elem;
  }

  render() {
    const card = document.createElement("div");
    const header = document.createElement("div");
    const body = document.createElement("div");
    card.className = "card exercise-editor my-3";
    header.className = "card-header exercise-editor-header d-flex justify-content-between";
    body.className = "card-body exercise-editor-body p-0";

    const left = document.createElement("div");
    left.className = "d-flex align-items-center gap-3";
    const label = document.createElement("div");
    label.innerHTML = "caption" in this.options ? this.options.caption : this.defaultCaption;
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
            const code = this.options.autorun ? this.initialCode : null;
            this.container.dispatchEvent(new CustomEvent('input', {
              detail: { code, commit: true }
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
          this.container.dispatchEvent(new CustomEvent('input', {
            detail: { commit: true }
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

export class WebRExerciseEditor extends ExerciseEditor {
  webRPromise: Promise<WebR>;
  defaultCaption: string;
  constructor(webRPromise: Promise<WebR>, code: string, options: ExerciseOptions) {
    super(code, options);
    this.webRPromise = webRPromise;
    this.completionMethods = this.setupCompletion();
  }

  render() {
    this.defaultCaption = 'R Code';
    return super.render();
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
    await completionMethods.assignLineBuffer(line.replace(/\)+$/, ""));
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
}

export class PyodideExerciseEditor extends ExerciseEditor {
  pyodidePromise: Promise<PyodideInterface>;
  defaultCaption: string;
  constructor(pyodidePromise: Promise<PyodideInterface>, code: string, options: ExerciseOptions) {
    super(code, options);
    this.pyodidePromise = pyodidePromise;
    this.setupCompletion();
  }

  render() {
    this.defaultCaption = 'Python Code';
    return super.render();
  }

  extensions() {
    const language = new Compartment();
    const tabSize = new Compartment();
    return [
      syntaxHighlighting(tagHighlighterTok),
      language.of(python()),
      tabSize.of(EditorState.tabSize.of(2)),
      Prec.high(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              this.container.dispatchEvent(new CustomEvent('input', {
                detail: { commit: true }
              }));
              return true;
            },
          },
        ]
      )),
    ];
  }

  async setupCompletion() {
    // TODO: Configurable autocomplete for python
    const pyodide = await this.pyodidePromise;
  }

  async doCompletion(context: CompletionContext) {
    return null;
  }

}
