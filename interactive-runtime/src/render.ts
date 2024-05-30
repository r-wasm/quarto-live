import { isRNull, isRCharacter, isRList } from 'webr'
import { arrayBufferToBase64 } from './utils'
import type { WebR, RObject, RLogical, RNull, RList, RCharacter } from 'webr'

type Meta = {
  name: string;
  content: string;
  [key: string]: string;
};

type Stylesheet = {
  rel?: string;
  type?: string;
  href: string;
};

type Script = {
  src: string;
  [key: string]: string;
};

type Attachment = {
  href: string;
  key: string;
  [key: string]: string;
};

export type HtmlDependency = {
  attachment: Attachment[];
  head?: string;
  meta: Meta[];
  name: string;
  pkg?: string;
  restyle?: boolean;
  script: Script[];
  src: { file?: string, href?: string };
  stylesheet: Stylesheet[];
  version: string;
};

const htmlDependencies: {
  [key: string]: string
}[] = [];

// list(foo = "bar", ...) -> { foo: "bar", ... }
async function fromNamedList<T>(rObj: RList): Promise<T> {
  const obj = await rObj.toJs({ depth: -1 });
  const entries = await Promise.all(
    obj.names.map(async (name, idx) => [
      name,
      await (obj.values[idx] as RCharacter).toString(),
    ])
  );
  return Object.fromEntries(entries);
}

// list("foo", "bar", ...) -> [{ key: "foo" }, { key: "bar" }, ...]
async function fromUnnamedList<T>(rObj: RList, key: string): Promise<T[]> {
  const obj = await rObj.toJs({ depth: -1 });
  return await Promise.all(
    obj.values.map(async (v) => {
      return { [key]: await (v as RCharacter).toString() };
    })
  ) as T[];
}

/*
 * list(list(foo = bar, ...), list(foo = baz, ...), ...) ->
 *   [{foo: bar, ...}, {foo: baz, ...}, ... ]
 */
async function fromListOfList<T>(rObj: RList): Promise<T[]> {
  const obj = await rObj.toJs({ depth: -1 });
  return await Promise.all(
    obj.values.map((v) => fromNamedList(v as RList))
  ) as T[];
}

async function normaliseHtmlDependency(obj: RObject): Promise<HtmlDependency> {
  const classes = await (await obj.class()).toArray();
  if (!classes.includes("html_dependency")) {
    throw new Error("Can't interpret R object of class `${classes}` as HTML dependency.");
  }

  const attachment = await obj.get("attachment") as RCharacter | RList | RNull;
  const head = await obj.get("head") as RCharacter | RNull;
  const meta = await obj.get("meta") as RList | RNull;
  const name = await (await obj.get("name")).toString();
  const pkg = await obj.get("package") as RList | RNull;
  const restyle = await obj.get("restyle") as RLogical | RNull;
  const script = await obj.get("script") as RCharacter | RList | RNull;
  const src = await obj.get("src") as RCharacter | RList | RNull;
  const stylesheet = await obj.get("stylesheet") as RCharacter | RList | RNull;
  const version = await (await obj.get("version")).toString();

  const result: HtmlDependency = {
    attachment: [],
    head: (isRNull(head)) ? undefined : await head.toString(),
    meta: [],
    name,
    pkg: (isRNull(pkg)) ? undefined : await pkg.toString(),
    restyle: (isRNull(restyle)) ? undefined : await restyle.toBoolean(),
    script: [],
    src: {},
    stylesheet: [],
    version,
  };

  if (isRCharacter(src)) {
    result.src = { file: await src.toString() };
  } else if (isRList(src)) {
    result.src = await fromNamedList(src);
  }

  if (!isRNull(meta)) {
    const metaObj = await meta.toObject();
    result.meta = await Promise.all(
      Object.entries(metaObj).map(async ([k, v]) => {
        return { name: k, content: await (v as RObject).toString() };
      })
    );
  }

  if (isRCharacter(stylesheet)) {
    result.stylesheet = (await stylesheet.toArray()).map((href) => {
      return { href };
    });
  } else if (isRList(stylesheet)) {
    const cssObj = await stylesheet.toJs({ depth: -1 });
    if (!cssObj.names) {
      result.stylesheet = await fromUnnamedList<StyleSheet>(stylesheet, "href");
    } else if (cssObj.names.includes("href")) {
      result.stylesheet = [await fromNamedList<StyleSheet>(stylesheet)];
    } else {
      result.stylesheet = await fromListOfList<StyleSheet>(stylesheet);
    }
  }

  if (isRCharacter(script)) {
    result.script = (await script.toArray()).map((src) => {
      return { src };
    });
  } else if (isRList(script)) {
    const cssObj = await script.toJs({ depth: -1 });
    if (!cssObj.names) {
      result.script = await fromUnnamedList<Script>(script, "src");
    } else if (cssObj.names.includes("src")) {
      result.script = [await fromNamedList<Script>(script)];
    } else {
      result.script = await fromListOfList<Script>(script);
    }
  }

  if (isRCharacter(attachment)) {
    result.attachment = (await attachment.toArray()).map((href, idx) => {
      return { key: (idx + 1).toString(), href };
    });
  } else if (isRList(attachment)) {
    const attObj = await attachment.toJs({ depth: -1 });
    if (!attObj.names) {
      result.attachment = await fromUnnamedList<Attachment>(attachment, "href");
      result.attachment.forEach((item, idx) => {
        item.key = (idx + 1).toString()
      });
    } else if (attObj.names.includes("href")) {
      result.attachment = [await fromNamedList<Attachment>(attachment)];
      result.attachment[0].key = '1';
    } else {
      result.attachment = await fromListOfList<Attachment>(attachment);
      result.attachment.forEach((item, idx) => {
        item.key = (idx + 1).toString()
      });
    }
  }

  return result;
}

export async function renderHtmlDependency(ctx: WebR, depRObject: RObject): Promise<Boolean> {
  const dep = await normaliseHtmlDependency(depRObject);
  const root = dep.pkg ? await ctx.evalRString(`find.package("${dep.pkg}")`) : '';

  // Register dependency and early return if already loaded.
  if (dep.name in htmlDependencies) {
    return false;
  } else {
    htmlDependencies[dep.name] = dep.version;
  }

  if (dep.head) {
    const elem = document.createElement("div");
    elem.innerHTML = dep.head;
    elem.childNodes.forEach((n) => document.head.appendChild(n));
  }

  if (dep.meta) {
    dep.meta.forEach(async (meta) => {
      const elem = document.createElement("meta");
      Object.entries(meta).map(([attr, value]) => {
        elem.setAttribute(attr, value ? value : '');
      });
      document.head.appendChild(elem);
    });
  }

  if (dep.stylesheet) {
    dep.stylesheet.forEach(async (css) => {
      const elem = document.createElement("link");
      if (dep.src.file) {
        const data = await ctx.FS.readFile(`${root}/${dep.src.file}/${css.href}`);
        css.href = `data:text/css;base64,${arrayBufferToBase64(data)}`;
      } else {
        css.href = `${dep.src.href}/${css.href}`;
      }

      if (!css.rel) elem.rel = "stylesheet";
      if (!css.type) elem.type = "text/css";
      Object.entries(css).map(([attr, value]) => {
        elem.setAttribute(attr, value ? value : '');
      });

      document.head.appendChild(elem);
    });
  }

  if (dep.script) {
    const scriptPromises = dep.script.map(async (script) => {
      const elem = document.createElement("script");
      if (dep.src.file) {
        const data = await ctx.FS.readFile(`${root}/${dep.src.file}/${script.src}`);
        script.src = `data:text/javascript;base64,${arrayBufferToBase64(data)}`;
      } else {
        script.src = `${dep.src.href}/${script.src}`;
      }

      // See details in shiny/srcts/src/shiny/render.ts#appendScriptTagsAsync
      elem.async = false;
      Object.entries(script).map(([attr, value]) => {
        if (attr === "async") {
          elem.async = (value === 'true');
        }
        elem.setAttribute(attr, value ? value : '');
      });

      const promise = new Promise((resolve, reject) => {
        elem.onload = () => resolve(null);
        elem.onerror = (e: Event) => reject(e);
      });

      document.head.appendChild(elem);

      return promise;
    });
    await Promise.allSettled(scriptPromises);
  }

  // TODO: Implement other dependencies (e.g. attachments)
  return true;
}
