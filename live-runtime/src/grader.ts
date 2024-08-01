import { EvaluateOptions, EvaluateContext } from "./evaluate";
import { WebREvaluator } from "./evaluate-webr";
import { PyodideEvaluator } from "./evaluate-pyodide";
import { EngineEnvironment, EnvironmentManager } from "./environment";

export class ExerciseGrader {
  evaluator: WebREvaluator | PyodideEvaluator;
  envManager: EnvironmentManager<EngineEnvironment>;
  context: EvaluateContext;
  options: EvaluateOptions;
  
  constructor(evaluator: WebREvaluator | PyodideEvaluator) {
    this.evaluator = evaluator;
    this.envManager = this.evaluator.envManager;
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
