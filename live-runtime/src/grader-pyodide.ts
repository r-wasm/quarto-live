import { PyodideEvaluator } from './evaluate-pyodide';
import { EnvironmentManager, PyodideEnvironment } from './environment';
import { Indicator } from './indicator';
import { PyodideInterface } from 'pyodide';
import { PyProxy } from 'pyodide/ffi';
import { ExerciseGrader } from './grader';

export class PyodideGrader extends ExerciseGrader {
  evaluator: PyodideEvaluator;
  envManager: EnvironmentManager<PyodideEnvironment>;
  pyodide: PyodideInterface;

  constructor(evaluator: PyodideEvaluator) {
    super(evaluator);
    this.pyodide = this.evaluator.pyodide;
  }

  async gradeExercise() {
    const user_code = this.context.code;

    // If there's no code to be evaluated yet, return blank feedback
    if (!user_code) {
      return null;
    }

    // Check for incomplete blanks in user code
    let checkResult = await this.blankCheck(user_code);
    if (checkResult) {
      return await this.feedbackAsHtmlAlert(checkResult);
    }

    // Check for a parse error before evaluating user code
    checkResult = await this.parseCheck(user_code);
    if (checkResult) {
      return await this.feedbackAsHtmlAlert(checkResult);
    }

    // Pre-evaluation code check
    // TODO: run user provided `code_check`

    // Evaluate user code and check with provided `check`
    let ind = this.context.indicator;
    if (!this.context.indicator) {
      ind = new Indicator();
    }
    ind.running();

    try {
      const evaluateResult = await this.evaluateExercise();
      if (!evaluateResult.value) {
        return null;
      }
      const container = await this.evaluator.asHtml(evaluateResult, this.options);
      const grade = await container.value.result.value;

      let message;
      let correct;
      if (await grade.type === "dict") {
        message = await grade.get("message");
        correct = await grade.get("correct");
      }

      if (message && correct !== undefined) {
        return await this.feedbackAsHtmlAlert(grade);
      }
      return container;
    } finally {
      ind.finished();
      if (!this.context.indicator) ind.destroy();
    }
  }

  async parseCheck(code:string, error_check?: string): Promise<PyProxy | null> {
    try {
      // Try to parse user code, catching any parse errors for feedback
      await this.pyodide.runPythonAsync(`
        from ast import parse
        parse(user_code)
      `, {
        locals: await this.pyodide.toPy({ user_code: code }),
      });
      return null;
    } catch (e) {
      // TODO: run user provided `error_check`
      return await this.pyodide.toPy({
        message: `
          It looks like this might not be valid Python code.
          Python cannot determine how to turn your text into a complete command.
          Your code may be indented incorrectly, or you may have forgotten to
          fill in a blank, to remove an underscore, to include a comma between
          arguments, or to close an opening <code>&quot;</code>, <code>'</code>,
          <code>(</code> or <code>{</code> with a matching <code>&quot;</code>,
          <code>'</code>, <code>)</code> or <code>}</code>.
        `,
        correct: false,
        location: "append",
        type: "error",
      })
    }
  }

  async blankCheck(code: string): Promise<PyProxy | null> {
    if (code.match(/_{6}_*/g)) {
      return await this.pyodide.toPy({
        message: "Please replace ______ with valid code.",
        correct: false,
        location: "append",
        type: "info",
      })
    }
    return null;
  }

  async evaluateSolution() {
    const exId = this.evaluator.options.exercise;
    const solutions = document.querySelectorAll(
      `.exercise-solution[data-exercise="${exId}"] > code.solution-code`
    );
    if (solutions.length > 0) {
      if (solutions.length > 1) {
        console.warn(`Multiple solutions found for exercise "${exId}", using first solution.`);
      }
      await this.envManager.create("solution", "prep");
      const envir = await this.envManager.get("solution");
      const code = solutions[0].textContent;

      const result = await this.pyodide.runPythonAsync(code, { globals: envir });
      return { envir, code, result };
    }
    return null;
  }

  async evaluateExercise() {
    await this.envManager.create("grading", "result");
    const envir_result = await this.envManager.get("result");
    const evaluate_result = this.evaluator.container.value.evaluate_result;
    const envir_prep = await this.envManager.get("prep");
    const last_value = this.evaluator.container.value.result.value;

    const checkerEnv: {[key: string]: any} = {
      user_code: this.context.code,
      stage: "check",
      engine: "python",
      label: this.context.options.exercise,
      check_code: this.getCheckingAlgorithm(),
      envir_result,
      evaluate_result,
      envir_prep,
      last_value,
      result: last_value,
      solution_code: null,
      solution_code_all: null,
      envir_solution: null,
      solution: null,
    }
  
    // Find the a solution for this exercise, if it exists
    const solution = await this.evaluateSolution();
    if (solution) {
      checkerEnv.solution_code = solution.code;
      checkerEnv.solution_code_all = [solution.code];
      checkerEnv.envir_solution = solution.envir;
      checkerEnv.solution = solution.result;
    }

    const checkerEnvObj = await this.pyodide.toPy(checkerEnv);
    await this.envManager.bind("_checker_env", checkerEnvObj, "grading");
    checkerEnvObj.destroy();

    const options = { ...this.options };
    options.error = false;
    options.output = true;
    const result = await this.evaluator.evaluate(
      `
        import pyodide
        feedback = None
        if (_checker_env["check_code"]):
          try:
            feedback = pyodide.code.eval_code(
              _checker_env["check_code"],
              locals = _checker_env,
            )
          except Exception as error:
            feedback = {
              'correct': False,
              'message': 'Error while checking \`{}\`: "{}"'.format(_checker_env["label"], error),
              'type': 'error'
            }
        feedback
      `,
      "grading",
      options
    );
    // console.log(result);
    return result;
  }

  async feedbackAsHtmlAlert(grade: PyProxy): Promise<HTMLElement> {
    const container = document.createElement("div");
    const type = await grade.get('type') as string;
    const correct = await grade.get('correct') as boolean;
    const message = await grade.get('message') as string;
    container.classList.add("alert");
    container.classList.add("exercise-grade");

    switch (type) {
      case "success":
        container.classList.add("alert-success");
        break;
      case "info":
        container.classList.add("alert-info");
        break;
      case "warning":
        container.classList.add("alert-warning");
        break;
      case "error":
      case "danger":
        container.classList.add("alert-danger");
        break;
      default: {
        container.classList.add(correct ? "alert-success" : "alert-danger");
      }
    }

    const content = document.createElement("span");
    content.className = "exercise-feedback";
    content.innerHTML = message;
    container.appendChild(content);
    return container;
  }
}
