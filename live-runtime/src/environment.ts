import { PyodideInterface } from 'pyodide';
import { PyProxy } from 'pyodide/ffi';
import { isRObject } from 'webr';
import type { REnvironment, RObject, Shelter, WebR } from 'webr';


export class WebREnvironmentManager {
  webRPromise: Promise<WebR>;
  shelter: Promise<Shelter>;
  env: { [key: string]: Promise<REnvironment>} = {};

  constructor(webRPromise: Promise<WebR>) {
    this.webRPromise = webRPromise;
    this.shelter = webRPromise.then((webR) => new webR.Shelter());
    this.env.global = webRPromise.then((webR) => webR.objs.globalEnv);
  }

  /*
    Convert JS object to R object for storing in evaluation environment
    Pass through RObject unchanged. For data.frame shaped objects, try
    data.frame conversion first, then fall back to creating an R list
    object if conversion fails.
  */
  async toR(value: any): Promise<RObject> {
    if (isRObject(value)) return value;

    const shelter = await this.shelter;
    if (value && value.constructor === Object) {
      value = await new shelter.RList(value);
    } else if (value && value.constructor === Array) {
      try {
        value = await new shelter.RObject(value);
      } catch (_e) {
        const e = _e as Error;
        if (!e.message.includes("Can't construct `data.frame`")) {
          throw e;
        }
        value = await Promise.all(value.map((v) => {
          return new shelter.RList(v).then((obj) => {
            return obj;
          })
        }));
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

  async create(target_id: string, parent_id: string) {
    if (target_id === parent_id || target_id === "global") {
      return this.get(target_id);
    }

    if (target_id in this.env) {
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
    await shelter.destroy(env);
    delete this.env[id];
  }
}

export class PyodideEnvironmentManager {
  pyodidePromise: Promise<PyodideInterface>;
  env: { [key: string]: Promise<PyProxy>} = {};

  constructor(pyodidePromise: Promise<PyodideInterface>) {
    this.pyodidePromise = pyodidePromise;
    this.env.global = pyodidePromise.then((pyodide) => pyodide.toPy({}));
  }

  async get(id: string = "global") {
    const pyodide = await this.pyodidePromise;
    if (!(id in this.env)) {
      this.env[id] = pyodide.toPy({});
    }
    return await this.env[id];
  }

  async bind(key: string, value: PyProxy, id: string = "global") {
    const environment = await this.get(id);
    const pyodide = await this.pyodidePromise;
    const locals = await pyodide.toPy({ environment, key, value });
    await pyodide.runPythonAsync(`environment[key] = value`, { locals });
    locals.destroy();
  }

  async create(target_id: string, parent_id: string) {
    if (target_id === parent_id || target_id === "global") {
      return this.get(target_id);
    }

    if (target_id in this.env) {
      await this.destroy(target_id);
    }

    const pyodide = await this.pyodidePromise;
    const parent = await this.get(parent_id);
    const locals = await pyodide.toPy({ parent });
    const parentCopy = await pyodide.runPythonAsync(`parent.copy()`, { locals });
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


