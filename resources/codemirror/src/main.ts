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
  options: { [key:string]: any };
  reactiveViewof = [
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (!update.docChanged) return;
      const dom = update.view.dom as HTMLElement & { value: any };
      dom.value = {
        code: update.state.doc.toString(),
        options: this.options,
      }
      dom.dispatchEvent(new CustomEvent('input'));
    }),
  ];
  constructor(code: string, options: { [key:string]: any }) {
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
  }
}

export default { EditorView, EditorState, CodeMirrorEditor };
