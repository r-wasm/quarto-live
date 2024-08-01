import { EngineEnvironment, EnvironmentManager, EnvLabel } from './environment';
import { Indicator } from './indicator'

export type EvaluateValue = {
  evaluator: ExerciseEvaluator;
  result: any;
  evaluate_result: any;
}
export type OJSEvaluateElement = HTMLElement & { value?: EvaluateValue };

export type EvaluateOptions = {
  define?: string[];
  echo: boolean;
  envir: string;
  error: boolean;
  eval: boolean;
  exercise?: string;
  include: boolean;
  input?: string[];
  output: string | boolean;
  setup?: string;
  timelimit: number;
  warning: boolean;
  "fig-width"?: number;
  "fig-height"?: number;
}

export interface EvaluateContext {
  code: string,
  options: EvaluateOptions,
  indicator?: Indicator,
};

// Build interleaved source code and HTML output
export interface ExerciseEvaluator {
  evaluate(code: string, envir?: EnvLabel, options?: EvaluateOptions): Promise<any>;
  process(inputs: { [key: string]: any }): Promise<void>;
  asOjs(value: any): Promise<any>;
  asHtml(value: any): Promise<OJSEvaluateElement>;
  context: EvaluateContext;
  options: EvaluateOptions;
  envManager : EnvironmentManager<EngineEnvironment>;
  container: OJSEvaluateElement;
}
