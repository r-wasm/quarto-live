import * as WebR from 'webr'
import { ExerciseEditor } from './editor'
import { highlightR, replaceHighlightR } from './highlighter'
import { WebREvaluator } from './evaluate'
import { EnvironmentManager } from './environment'
import { WebRGrader } from './grader'

async function setupR(webR: WebR.WebR) {
  return await webR.evalRVoid(require('./assets/R/setup.R'));
}

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
      setupR: typeof setupR;
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
  setupR,
};

export { WebR, ExerciseEditor, WebREvaluator, highlightR, replaceHighlightR }
