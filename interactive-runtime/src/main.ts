import * as WebR from 'webr'
import type { PyodideInterface } from 'pyodide'
import { WebRExerciseEditor, PyodideExerciseEditor } from './editor'
import { highlightR, highlightPython, interpolateR } from './highlighter'
import { WebREvaluator, PyodideEvaluator } from './evaluate'
import { EnvironmentManager } from './environment'
import { WebRGrader } from './grader'

async function setupR(webR: WebR.WebR) {
  return await webR.evalRVoid(require('./assets/R/setup.R'));
}

async function setupPython(pyodide: PyodideInterface) {
  const matplotlib_display = require('./assets/Python/matplotlib_display.py');
  pyodide.FS.mkdir('/pyodide')
  pyodide.FS.writeFile('/pyodide/matplotlib_display.py', matplotlib_display);
  await pyodide.runPythonAsync(`
    import sys
    import os
    import micropip
    import pyodide_http
    import matplotlib

    pyodide_http.patch_all()
    sys.path.insert(0, "/pyodide/")
    matplotlib.use("module://matplotlib_display")
  `)
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
      setupPython: typeof setupPython;
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
  setupPython,
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
  setupPython,
}
