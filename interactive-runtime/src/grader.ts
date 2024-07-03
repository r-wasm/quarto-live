import { WebR, RObject, RLogical, isRNull, isRList } from 'webr'
import { RList, RNull } from 'webr'
import { EvaluateOptions, EnvLabels, EvaluateContext } from "./evaluate"
import { WebREvaluator } from "./evaluate-webr"
import { PyodideEvaluator } from "./evaluate-pyodide"
import { PyodideEnvironmentManager, WebREnvironmentManager } from './environment'
import { Indicator } from './indicator'
import { PyodideInterface } from 'pyodide'
import { PyProxy } from 'pyodide/ffi'

export type ExerciseGraderCode = {
  code_check?: string;
  error_check?: string;
  check?: string;
  solution?: string;
}

class ExerciseGrader {
  evaluator: WebREvaluator | PyodideEvaluator;
  envManager: WebREnvironmentManager | PyodideEnvironmentManager;
  context: EvaluateContext;
  options: EvaluateOptions;
  envLabels: EnvLabels;
  
  constructor(evaluator: WebREvaluator | PyodideEvaluator) {
    this.evaluator = evaluator;
    this.envManager = this.evaluator.envManager;
    this.envLabels = this.evaluator.envLabels;
    this.context = this.evaluator.context;

    // Fixed grading options
    this.options = {
      envir: this.evaluator.options.envir,
      eval: true,
      echo: false,
      warning: true,
      error: false,
      include: true,
      output: true,
      timelimit: 600,
    };
  }

  getCheckingAlgorithm(): string | undefined {
    const exId = this.evaluator.options.exercise;
    const check = document.querySelectorAll(
      `script[type=\"exercise-check-${exId}-contents\"]`
    );
    if (check.length > 0) {
      if (check.length > 1) {
        console.warn(`Multiple \`check\` blocks found for exercise "${exId}", using the first.`);
      }
      const block = JSON.parse(atob(check[0].textContent));
      return block.code;
    }
  }
}

export class WebRGrader extends ExerciseGrader {
  evaluator: WebREvaluator;
  envManager: WebREnvironmentManager;
  webR: WebR;

  constructor(evaluator: WebREvaluator) {
    super(evaluator)
    this.webR = this.evaluator.webR;
  }

  async gradeExercise() {
    const user_code = this.context.code;
  
    // Check for incomplete blanks in user code
    let checkResult = await this.blankCheck(user_code);
    if (!isRNull(checkResult)) {
      return await this.feedbackAsHtmlAlert(checkResult);
    }

    // Check for a parse error before evaluating user code
    checkResult = await this.parseCheck(user_code);
    if (!isRNull(checkResult)) {
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
      checkResult = await this.evaluateExercise();
      if (isRNull(checkResult)) {
        return null;
      }
      const container = await this.evaluator.asHtml(checkResult, this.options);
      const result = await container.value.result as RObject;
      const classList = await (await result.class()).toArray();

      // Is this a feedback from gradethis
      if (classList.includes("gradethis_graded") || classList.includes("gradethis_feedback")) {
        return await this.feedbackAsHtmlAlert(result);
      }

      // This is feedback contained in an R list object
      if (isRList(result)) {
        const message = await result.get("message");
        const correct = await result.get("correct");
        if (!isRNull(message) && !isRNull(correct)) {
          return await this.feedbackAsHtmlAlert(result);
        }
      }

      return container;
    } finally {
      ind.finished();
      if (!this.context.indicator) ind.destroy();
    }
  }

  async parseCheck(code:string, error_check?: string): Promise<RList | RNull> {
    const shelter = await this.evaluator.shelter;
    try {
      // Try to parse user code, catching any parse errors for feedback
      await shelter.evalR("parse(text = user_code)", {
        env: { user_code: code },
      });
      return this.evaluator.webR.objs.null;
    } catch (e) {
      // TODO: run user provided `error_check`
      return await new shelter.RList({
        message: await shelter.evalR(`htmltools::HTML("
          It looks like this might not be valid R code.
          R cannot determine how to turn your text into a complete command.
          You may have forgotten to fill in a blank,
          to remove an underscore, to include a comma between arguments,
          or to close an opening <code>&quot;</code>, <code>'</code>, <code>(</code>
          or <code>{</code> with a matching <code>&quot;</code>, <code>'</code>,
          <code>)</code> or <code>}</code>.
        ")`),
        correct: false,
        location: "append",
        type: "error",
      })
    } finally {
      shelter.purge();
    }
  }

  async blankCheck(code: string): Promise<RList | RNull> {
    const shelter = await this.evaluator.shelter;
    if (code.match(/_{6}_*/g)) {
      return await new shelter.RList({
        message: "Please replace ______ with valid code.",
        correct: false,
        location: "append",
        type: "info",
      })
    }
    return this.evaluator.webR.objs.null;
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
      const shelter = await this.evaluator.shelter;
      await this.envManager.create(this.envLabels.solution, this.envLabels.prep);
      
      const envir = await this.envManager.get(this.envLabels.solution);
      const code = solutions[0].textContent;

      const result = await shelter.evalR(code, { env: envir });
      return { envir, code, result };
    }
    return null;
  }

  async evaluateExercise() {
    await this.envManager.create(this.envLabels.grading, this.envLabels.result);
    const shelter = await this.evaluator.shelter;
    try {
      const envir_result = await this.envManager.get(this.envLabels.result);
      const evaluate_result = this.evaluator.container.value.evaluate_result;
      const envir_prep = await this.envManager.get(this.envLabels.prep);
      const last_value = this.evaluator.container.value.result;

      const args: {[key: string]: any} = {
        user_code: this.context.code,
        stage: "check",
        engine: "r",
        label: this.context.options.exercise || this.webR.objs.null,
        check_code: this.getCheckingAlgorithm() || this.webR.objs.null,
        envir_result,
        evaluate_result,
        envir_prep,
        last_value,
        solution_code: this.webR.objs.null,
        solution_code_all: this.webR.objs.null,
        envir_solution: this.webR.objs.null,
        solution: this.webR.objs.null,
      }
    
      // Find the a solution for this exercise, if it exists
      const solution = await this.evaluateSolution();
      if (solution) {
        args.solution_code = solution.code;
        args.solution_code_all = [solution.code];
        args.envir_solution = solution.envir;
        args.solution = solution.result;
      }

      const argsObj = await new shelter.RList(args);
      this.envManager.bind(".checker_args", argsObj, this.envLabels.grading);
      const result = await this.evaluator.evaluate(
        "do.call(getOption('webr.exercise.checker'), .checker_args)",
        "grading",
        this.options
      );
      // debug exercise checker
      // this.evaluator.webR.evalR("print(result)", { env: { result }})
      return result;
    } finally {
      shelter.purge();
    }
  }

  async feedbackAsHtmlAlert(grade: RObject): Promise<HTMLElement> {
    const shelter = await this.evaluator.shelter;

    const container = document.createElement("div");
    const typeCharacter = await grade.get('type');
    const correctLogical = await grade.get('correct') as RLogical;
    container.classList.add("alert");
    container.classList.add("exercise-grade");

    switch (await typeCharacter.toString()) {
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
        const correct = await correctLogical.toArray();
        if (correct.length > 0 && correct[0]) {
          container.classList.add("alert-success");
        } else {
          container.classList.add("alert-danger");
        }
      }
    }

    const content = document.createElement("span");
    content.className = "exercise-feedback";

    let message = await grade.get('message');
    const knit = await shelter.captureR(
      "knitr::knit_print(grade$message)"
    , { env: { grade } });
    message = knit.result;
    let messageText = await message.toString();

    // Main message text display
    const elem = document.createElement("div");
    elem.innerHTML = messageText;
    container.append(...elem.childNodes);

    const error = await grade.get('error');
    if (!isRNull(error)) {
      message = await error.get('message');
      messageText = await message.toString();
      const call = await error.get("call");
      const gradethis_call = await error.get("gradethis_call");

      // Error message display
      let pElem = document.createElement("p");
      let preElem = document.createElement("pre");
      preElem.appendChild(document.createTextNode(`Error: ${messageText}`));
      pElem.appendChild(preElem);
      container.appendChild(pElem);

      // Details element with additional call site information
      let detailsElem = document.createElement("details");
      preElem = document.createElement("pre");
      preElem.appendChild(document.createTextNode(await call.toString()));
      detailsElem.appendChild(preElem);
      preElem = document.createElement("pre");
      preElem.appendChild(document.createTextNode(await gradethis_call.toString()));
      detailsElem.appendChild(preElem);
      container.appendChild(detailsElem);
    }
    return container;
  }
}

export class PyodideGrader extends ExerciseGrader {
  evaluator: PyodideEvaluator;
  envManager: PyodideEnvironmentManager;
  pyodide: PyodideInterface;

  constructor(evaluator: PyodideEvaluator) {
    super(evaluator);
    this.pyodide = this.evaluator.pyodide;
  }

  async gradeExercise() {
    const user_code = this.context.code;
  
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
      await this.envManager.create(this.envLabels.solution, this.envLabels.prep);
      
      const envir = await this.envManager.get(this.envLabels.solution);
      const code = solutions[0].textContent;

      const result = await this.pyodide.runPythonAsync(code, { globals: envir });
      return { envir, code, result };
    }
    return null;
  }

  async evaluateExercise() {
    await this.envManager.create(this.envLabels.grading, this.envLabels.result);
    const envir_result = await this.envManager.get(this.envLabels.result);
    const evaluate_result = this.evaluator.container.value.evaluate_result;
    const envir_prep = await this.envManager.get(this.envLabels.prep);
    const last_value = this.evaluator.container.value.result;

    const args: {[key: string]: any} = {
      user_code: this.context.code,
      stage: "check",
      engine: "python",
      label: this.context.options.exercise,
      check_code: this.getCheckingAlgorithm(),
      envir_result,
      evaluate_result,
      envir_prep,
      last_value,
      solution_code: null,
      solution_code_all: null,
      envir_solution: null,
      solution: null,
    }
  
    // Find the a solution for this exercise, if it exists
    const solution = await this.evaluateSolution();
    if (solution) {
      args.solution_code = solution.code;
      args.solution_code_all = [solution.code];
      args.envir_solution = solution.envir;
      args.solution = solution.result;
    }

    const argsObj = await this.pyodide.toPy(args);
    await this.envManager.bind("_checker_args", argsObj, this.envLabels.grading);
    // const globals = await this.envManager.get(this.envLabels.grading);
    // await this.pyodide.runPythonAsync(`print(foo)`, { globals });
    argsObj.destroy();
    const result = await this.evaluator.evaluate(
      `
        import pyodide
        feedback = None
        if (_checker_args["check_code"]):
          try:
            feedback = pyodide.code.eval_code(
              _checker_args["check_code"],
              locals = _checker_args["envir_result"]
            )
          except Exception as error:
            feedback = {
              'correct': False,
              'message': 'Error while checking \`{}\`: "{}"'.format(_checker_args["label"], error),
              'type': 'error'
            }
        feedback
      `,
      "grading",
      this.options
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
