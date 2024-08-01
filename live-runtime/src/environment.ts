import { PyodideInterface } from 'pyodide';
import { PyProxy } from 'pyodide/ffi';
import { isRObject } from 'webr';
import type { REnvironment, RObject, Shelter, WebR } from 'webr';
import { EvaluateContext } from './evaluate';

export type EngineEnvironment = WebREnvironment | PyodideEnvironment;
type EnvironmentItem<T> = T extends WebREnvironment ? Promise<REnvironment> : Promise<PyProxy>;

export type EnvLabels = {
  prep: string;
  result: string;
  grading: string;
  solution: string;
  global: "global";
}
export type EnvLabel = keyof EnvLabels;

export class EnvironmentManager<T extends EngineEnvironment> {
  manager: T;
  labels: EnvLabels;
  discard: boolean;

  constructor(engineEnvironment: T, context: EvaluateContext) {
    this.manager = engineEnvironment;
    const options = context.options;
    if (!options.exercise || options.envir === "global") {
      this.labels = {
        prep: options.envir,
        result: options.envir,
        grading: options.envir,
        solution: options.envir,
        global: "global",
      }
      this.discard = false;
    } else {
      this.labels = {
        prep: `${options.envir}-prep`,
        result: `${options.envir}-result`,
        grading: `${options.envir}-grading`,
        solution: `${options.envir}-solution`,
        global: "global",
      }
      this.discard = options.envir === `exercise-env-${options.exercise}`;
    }
  }

  get(label: EnvLabel = "global") {
    return this.manager.get(this.labels[label]) as EnvironmentItem<T>;
  }

  bind(key: string, value: any, label: EnvLabel = "global"){
    return this.manager.bind(key, value, this.labels[label]);
  }

  create(target: EnvLabel, parent: EnvLabel) {
    return this.manager.create(
      this.labels[target],
      this.labels[parent],
      this.discard,
    ) as EnvironmentItem<T>;;
  }

  destroy(label: EnvLabel) {
    return this.manager.destroy(this.labels[label]);
  }
}

export class WebREnvironment {
  static #instance: WebREnvironment;
  webR: WebR;
  shelter: Promise<Shelter>;
  env: { [key: string]: Promise<REnvironment>} = {};

  private constructor(webR: WebR) {
    this.shelter = new webR.Shelter();
    this.env.global = Promise.resolve().then(() => webR.objs.globalEnv);
  }

  static instance(webR: WebR): WebREnvironment {
    if (!WebREnvironment.#instance) {
      WebREnvironment.#instance = new WebREnvironment(webR);
    }
    return WebREnvironment.#instance;
  }

  /*
    Convert JS object to R object for storing in evaluation environment
    Pass through RObject unchanged. For data.frame shaped objects, try
    data.frame conversion first, then fall back to creating an R list
    object if conversion fails.
  */
  async toR(value: any): Promise<RObject> {
    if (!value || isRObject(value)) return value;

    const shelter = await this.shelter;
    if (value.constructor === Object) {
      try {
        return await new shelter.RObject(value);
      } catch (_e) {
        const e = _e as Error;
        if (!e.message.includes("Can't construct `data.frame`")) {
          throw e;
        }
        return await new shelter.RList(
          Object.fromEntries(
            await Promise.all(Object.entries(value).map(async ([k, v]) => {
              return [k, await this.toR(v)];
            }))
          )
        );
      }
    }
    
    if (value.constructor === Array) {
      try {
        return await new shelter.RObject(value);
      } catch (_e) {
        const e = _e as Error;
        if (!e.message.includes("Can't construct `data.frame`")) {
          throw e;
        }
        return await new shelter.RList(
          await Promise.all(value.map((v) => this.toR(v)))
        );
      }
    }
    return value;
  }

  async get(id: string = "global") {
    const shelter = await this.shelter;

    if (!(id in this.env)) {
      this.env[id] = shelter.evalR(`new.env(parent = globalenv())`) as Promise<REnvironment>;
    }

    return await this.env[id];
  }

  async bind(key: string, value: any, id: string = "global") {
    const environment = await this.get(id);
    value = await this.toR(value);
    await environment.bind(key, value);
  }

  async create(target_id: string, parent_id: string, discard: boolean = true) {
    if (target_id === parent_id || target_id === "global") {
      return this.get(target_id);
    }

    if (target_id in this.env) {
      if (!discard) {
        return this.get(target_id);
      }
      await this.destroy(target_id);
    }

    const shelter = await this.shelter;
    const parent = await this.get(parent_id);
    this.env[target_id] = shelter.evalR(
      "new.env(parent = parent)",
      { env: { parent } }
    ) as Promise<REnvironment>;

    return await this.env[target_id];
  }

  async destroy(id: string) {
    if (id == "global" || !(id in this.env)) {
      return;
    }
    const shelter = await this.shelter;
    const env = await this.env[id];
    try {
      await shelter.destroy(env);
    } catch (_err) {
      const err = _err as Error;
      // Muffle error if environment has already been destroyed.
      // TODO: The user is probably invoking OJS events very quickly, we should
      // be debouncing input.
      if (!err.message.includes("Can't find object in shelter.")) {
        throw err;
      }
    }
    delete this.env[id];
  }
}

export class PyodideEnvironment {
  static #instance: PyodideEnvironment;
  pyodide: PyodideInterface;
  env: { [key: string]: Promise<PyProxy>} = {};

  private constructor(pyodide: PyodideInterface) {
    this.pyodide = pyodide;
    this.env.global = Promise.resolve().then(() => pyodide.toPy({}));
  }

  static instance(pyodide: PyodideInterface): PyodideEnvironment {
    if (!PyodideEnvironment.#instance) {
      PyodideEnvironment.#instance = new PyodideEnvironment(pyodide);
    }
    return PyodideEnvironment.#instance;
  }

  async get(id: string = "global") {
    if (!(id in this.env)) {
      this.env[id] = this.pyodide.toPy({});
    }
    return await this.env[id];
  }

  async bind(key: string, value: PyProxy, id: string = "global") {
    const environment = await this.get(id);
    const locals = await this.pyodide.toPy({ environment, key, value });
    await this.pyodide.runPythonAsync(`environment[key] = value`, { locals });
    locals.destroy();
  }

  async create(target_id: string, parent_id: string, discard: boolean = true) {
    if (target_id === parent_id || target_id === "global") {
      return this.get(target_id);
    }

    if (target_id in this.env) {
      if (!discard) {
        return this.get(target_id);
      }
      await this.destroy(target_id);
    }

    const parent = await this.get(parent_id);
    const locals = await this.pyodide.toPy({ parent });
    const parentCopy = await this.pyodide.runPythonAsync(`parent.copy()`, { locals });
    locals.destroy();
    this.env[target_id] = parentCopy;
    return await this.env[target_id];
  }

  async destroy(id: string) {
    if (id == "global" || !(id in this.env)) {
      return;
    }
    const env = await this.env[id];
    await env.destroy();
    delete this.env[id];
  }
}


