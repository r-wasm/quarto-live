import * as WebR from 'webr'
import { ExerciseEditor } from './editor'
import { highlightR, replaceHighlightR } from './highlighter'
import { WebREvaluator } from './evaluate'
import { EnvironmentManager } from './environment'
import { WebRGrader } from './grader'

declare global {
  interface Window {
    _webr_ojs_runtime?: {
      WebR: typeof WebR;
      ExerciseEditor: typeof ExerciseEditor;
      WebREvaluator: typeof WebREvaluator;
      WebRGrader: typeof WebRGrader;
      EnvironmentManager: typeof EnvironmentManager;
      highlightR: typeof highlightR;
      replaceHighlightR: typeof replaceHighlightR;
    };
  }
}

window._webr_ojs_runtime = {
  WebR,
  ExerciseEditor,
  WebREvaluator,
  WebRGrader,
  EnvironmentManager,
  highlightR,
  replaceHighlightR,
};

export { WebR, ExerciseEditor, WebREvaluator, highlightR, replaceHighlightR }
