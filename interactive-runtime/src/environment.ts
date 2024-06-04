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

  async destroy(id: string) {
    if (id == "global" || !(id in this.env)) {
      return;
    }
    const shelter = await this.shelter;
    const env = await this.env[id];
    await shelter.destroy(env);
  }
}


