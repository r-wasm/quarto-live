import { Indicator } from './indicator'
import { PyodideEnvironmentManager, WebREnvironmentManager } from './environment'

export type OJSElement = HTMLElement & { value?: any };

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

// prep - Environment after setup
// result - Environment after execution
// grading - Environment for grading function
export type EnvLabels = {
  prep: string;
  result: string;
  grading: string;
  solution: string;
}
export type EnvLabel = keyof EnvLabels;
type EnvManager = WebREnvironmentManager | PyodideEnvironmentManager;

// Build interleaved source code and HTML output
export interface ExerciseEvaluator {
  evaluate(code: string, envir?: EnvLabel, options?: EvaluateOptions): Promise<any>;
  process(inputs: { [key: string]: any }): Promise<void>;
  asOjs(value: any): Promise<any>;
  asHtml(value: any): Promise<OJSElement>;
  context: EvaluateContext;
  options: EvaluateOptions;
  envLabels: EnvLabels;
  envManager: EnvManager;
  container: OJSElement;
}
