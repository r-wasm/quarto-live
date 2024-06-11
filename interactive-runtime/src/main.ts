import * as WebR from 'webr'
import { WebRExerciseEditor, PyodideExerciseEditor } from './editor'
import { highlightR, highlightPython, interpolateR } from './highlighter'
import { WebREvaluator, PyodideEvaluator } from './evaluate'
import { EnvironmentManager } from './environment'
import { WebRGrader } from './grader'

async function setupR(webR: WebR.WebR) {
  return await webR.evalRVoid(require('./assets/R/setup.R'));
}

declare global {
  interface Window {
    _exercise_ojs_runtime?: {
      PyodideExerciseEditor: typeof PyodideExerciseEditor;
      PyodideEvaluator: typeof PyodideEvaluator;
      WebR: typeof WebR;
      WebRExerciseEditor: typeof WebRExerciseEditor;
      WebREvaluator: typeof WebREvaluator;
      WebRGrader: typeof WebRGrader;
      EnvironmentManager: typeof EnvironmentManager;
      highlightR: typeof highlightR;
      highlightPython: typeof highlightPython;
      interpolateR: typeof interpolateR;
      setupR: typeof setupR;
    };
  }
}

window._exercise_ojs_runtime = {
  PyodideExerciseEditor,
  PyodideEvaluator,
  WebR,
  WebRExerciseEditor,
  WebREvaluator,
  WebRGrader,
  EnvironmentManager,
  highlightR,
  highlightPython,
  interpolateR,
  setupR,
};

export {
  PyodideExerciseEditor,
  PyodideEvaluator,
  WebR,
  WebRExerciseEditor,
  WebREvaluator,
  WebRGrader,
  EnvironmentManager,
  highlightR,
  highlightPython,
  interpolateR,
  setupR,
}
