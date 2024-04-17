import { basicSetup } from 'codemirror'
import { EditorView, ViewUpdate } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { r } from 'codemirror-lang-r'

export type EditorConfig = {
  doc?: string;
}

export class CodeMirrorEditor {
  state: EditorState;
  view: EditorView;
  reactiveViewof = [
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (!update.docChanged) return;
      const dom = update.view.dom as HTMLElement & { value: any };
      dom.value = update.state.doc.toString();
      dom.dispatchEvent(new CustomEvent('input'));
    }),
  ];
  constructor(config: EditorConfig) {
    this.state = EditorState.create({
      doc: config.doc,
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

export default { EditorView, EditorState, CodeMirrorEditor };
