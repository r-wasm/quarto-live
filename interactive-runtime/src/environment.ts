import type { REnvironment, Shelter, WebR } from 'webr'

export class EnvironmentManager {
  webRPromise: Promise<WebR>;
  shelter: Promise<Shelter>;
  env: { [key: string]: Promise<REnvironment>} = {};

  constructor(webRPromise: Promise<WebR>) {
    this.webRPromise = webRPromise;
    this.shelter = webRPromise.then((webR) => new webR.Shelter());
    this.env.global = webRPromise.then((webR) => webR.objs.globalEnv);
  }

  async get(id: string = "global") {
    const shelter = await this.shelter;

    if (!(id in this.env)) {
      this.env[id] = shelter.evalR(`new.env(parent = globalenv())`) as Promise<REnvironment>;
    }

    return await this.env[id];
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


