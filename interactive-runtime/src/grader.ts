import { ExerciseEvaluator, EvaluatorEnvironment } from "./evaluate"
import { EnvironmentManager } from './environment'
import { isRFunction } from "webr"

export type ExerciseGraderCode = {
  code_check?: string;
  error_check?: string;
  check?: string;
  solution?: string;
}

export class ExerciseGrader {
  evaluator: ExerciseEvaluator;
  grading: ExerciseGraderCode;
  envir: EvaluatorEnvironment;
  environmentManager: EnvironmentManager;
  constructor(evaluator: ExerciseEvaluator, grading: ExerciseGraderCode) {
    this.evaluator = evaluator;
    this.grading = grading;
    this.envir = this.evaluator.envir;
    this.environmentManager = this.evaluator.environmentManager;
  }

  async check() {

    await this.environmentManager.create(this.envir.grading, this.envir.result);

    const checkFunction = await this.evaluator.evaluateQuietly(this.grading.check, "grading");
    if (!isRFunction(checkFunction)) {
      throw new Error("An interactive grading code block must contain a grading function.")
    }

    // Bind checking function into environment
    this.evaluator.bind(".checkFunction", checkFunction, "grading");
    this.evaluator.bind(".result", this.evaluator.container.value.result, "grading");
    return await this.evaluator.evaluate(".checkFunction(.result)", "grading");
  }
}
