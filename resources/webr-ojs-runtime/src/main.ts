import { basicSetup } from 'codemirror'
import { EditorView, ViewUpdate } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { r } from 'codemirror-lang-r'

export type OJSElement = HTMLElement & { value: any };

type EditorOptions = { [key: string]: string };
type ExerciseButtonSpec = {
  text: string;
  icon: string;
  type: string;
  onclick?: ((ev: MouseEvent) => any);
}

export class ExerciseEditor {
  code: string
  state: EditorState;
  view: EditorView;
  container: OJSElement;
  options: EditorOptions;
  reactiveViewof = [
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (!update.docChanged) return;
      this.container.value.code = update.state.doc.toString();
      this.container.dispatchEvent(new CustomEvent('input'));
    }),
  ];

  constructor(container: OJSElement, code: string, options: EditorOptions) {
    if (typeof code !== "string") {
      throw new Error("Can't create editor, `code` must be a string.");
    }

    this.container = container;
    this.code = code;
    this.options = options;
    this.state = EditorState.create({
      doc: code,
      extensions: [
        basicSetup,
        this.reactiveViewof,
        r(),
      ],
    });

    this.view = new EditorView({
      state: this.state,
    });

    const dom = this.render();
    this.container.appendChild(dom);
    this.container.value = { code, options };
  }

  renderButton(spec: ExerciseButtonSpec) {
    const dom = document.createElement("a");
    dom.className = `btn btn-${spec.type} text-nowrap`;
    dom.setAttribute("style", "--bs-btn-padding-y: .15rem; --bs-btn-padding-x: .5rem; --bs-btn-font-size: .75rem;");
    dom.innerHTML = `<i class="bi bi-${spec.icon}"></i> ${spec.text}`;
    dom.onclick = spec.onclick || null;
    return dom;
  }

  renderButtonGroup(buttons: (HTMLButtonElement | HTMLAnchorElement)[]) {
    const group = document.createElement("div");
    group.className = "btn-group btn-group-sm";
    buttons.forEach((spec) => group.appendChild(spec));
    return group;
  }

  renderSpinner() {
    const dom = document.createElement("div");
    dom.className = "spinner-grow spinner-grow-sm";
    dom.setAttribute("role", "status");
    return dom;
  }

  render() {
    const card = document.createElement("div");
    const header = document.createElement("div");
    const body = document.createElement("div");
    card.className = "card my-3";
    header.className = "card-header d-flex justify-content-between";
    body.className = "card-body p-0";

    const left = document.createElement("div");
    left.className = "d-flex align-items-center gap-2";
    const label = document.createElement("div");
    label.innerHTML = this.options.caption;
    left.appendChild(label);

    const leftButtons: (HTMLButtonElement | HTMLAnchorElement)[] = [];
    if (this.options.startover === 'true') {
      leftButtons.push(this.renderButton({
        text: "Start Over",
        icon: "arrow-repeat",
        type: "secondary",
        onclick: () => {
          this.view.dispatch({
            changes: {
              from: 0,
              to: this.view.state.doc.length,
              insert: this.code,
            }
          });
        }
      }));
    }

    if (false) {
      leftButtons.push(this.renderButton({
        text: "Show Hint",
        icon: "lightbulb",
        type: "secondary",
      }));
    }
    left.appendChild(this.renderButtonGroup(leftButtons));
    header.appendChild(left);

    let right = document.createElement("div");
    right.className = "d-flex align-items-center gap-2";

    if (false) {
      right.appendChild(this.renderSpinner());
      right.appendChild(this.renderButtonGroup([
        this.renderButton({ text: "Run Code", icon: "arrow-repeat", type: "primary" }),
        this.renderButton({ text: "Submit Answer", icon: "lightbulb", type: "primary" }),
      ]));
      header.appendChild(right);
    }
    card.appendChild(header);

    body.appendChild(this.view.dom);
    card.appendChild(body);
    return card;
  }
}
