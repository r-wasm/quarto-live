import { basicSetup } from 'codemirror'
import { EditorView, ViewUpdate } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { r } from 'codemirror-lang-r'

export type OJSElement = HTMLElement & { value: any };

export class ExerciseEditor {
  state: EditorState;
  view: EditorView;
  container: OJSElement;
  reactiveViewof = [
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (!update.docChanged) return;
      this.container.value.code = update.state.doc.toString();
      this.container.dispatchEvent(new CustomEvent('input'));
    }),
  ];
  constructor(container: OJSElement, code: string) {
    this.container = container;
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
  }
}

export default { ExerciseEditor };
