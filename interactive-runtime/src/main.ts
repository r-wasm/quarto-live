import * as WebR from 'webr'
import { ExerciseEditor } from './editor'
import { highlightR, replaceHighlightR } from './highlighter'
import { WebREvaluator} from './evaluate'

declare global {
  interface Window {
    _webr_ojs_runtime?: {
      WebR: typeof WebR;
      ExerciseEditor: typeof ExerciseEditor;
      WebREvaluator: typeof WebREvaluator;
      highlightR: typeof highlightR;
      replaceHighlightR: typeof replaceHighlightR;
    };
  }
}

window._webr_ojs_runtime = {
  WebR,
  ExerciseEditor,
  WebREvaluator,
  highlightR,
  replaceHighlightR,
};

export { WebR, ExerciseEditor, WebREvaluator, highlightR, replaceHighlightR }
