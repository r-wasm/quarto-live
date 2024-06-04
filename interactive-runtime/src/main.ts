import * as WebR from 'webr'
import { ExerciseEditor } from './editor'
import { highlightR, replaceHighlightR } from './highlighter'
import { WebREvaluator } from './evaluate'
import { EnvironmentManager } from './environment'
import { ExerciseGrader } from './grader'

declare global {
  interface Window {
    _webr_ojs_runtime?: {
      WebR: typeof WebR;
      ExerciseEditor: typeof ExerciseEditor;
      WebREvaluator: typeof WebREvaluator;
      EnvironmentManager: typeof EnvironmentManager;
      ExerciseGrader: typeof ExerciseGrader;
      highlightR: typeof highlightR;
      replaceHighlightR: typeof replaceHighlightR;
    };
  }
}

window._webr_ojs_runtime = {
  WebR,
  ExerciseEditor,
  WebREvaluator,
  EnvironmentManager,
  ExerciseGrader,
  highlightR,
  replaceHighlightR,
};

export { WebR, ExerciseEditor, WebREvaluator, highlightR, replaceHighlightR }
