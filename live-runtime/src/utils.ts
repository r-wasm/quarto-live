// From https://stackoverflow.com/a/9458996
export function arrayBufferToBase64(buffer: ArrayBuffer) {
  var binary = '';
  var bytes = new Uint8Array(buffer);
  var len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// From https://stackoverflow.com/a/30106551
export function b64Encode(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => {
      return String.fromCharCode(parseInt(p1, 16))
  }))
}

export function b64Decode(str) {
  return decodeURIComponent(atob(str).split('').map((c) => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));
}

export function isImageBitmap(value: any): value is ImageBitmap {
  return (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap);
}

export function replaceInObject<T>(
  obj: T | T[],
  test: (obj: any) => boolean,
  replacer: (obj: any, ...replacerArgs: any[]) => unknown,
  ...replacerArgs: unknown[]
): T | T[] {
  if (
    obj === null ||
    obj === undefined ||
    isImageBitmap(obj) ||
    obj instanceof ArrayBuffer ||
    ArrayBuffer.isView(obj)
  ) {
    return obj;
  }
  if (test(obj)) {
    return replacer(obj, ...replacerArgs) as T;
  }
  if (Array.isArray(obj)) {
    return (obj as unknown[]).map((v) =>
      replaceInObject(v, test, replacer, ...replacerArgs)
    ) as T[];
  }
  if (typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, replaceInObject(v, test, replacer, ...replacerArgs)])
    ) as T;
  }
  return obj;
}

export function replaceScriptChildren(container: HTMLElement) {
  for (let script of container.getElementsByTagName('script')) {
    if (!script.type || script.type == "text/javascript" || script.type == "module") {
      const newScript = document.createElement('script');
      if (script.async) newScript.async = script.async;
      if (script.crossOrigin) newScript.crossOrigin = script.crossOrigin;
      if (script.defer) newScript.defer = script.async;
      if (script.integrity) newScript.integrity = script.integrity;
      if (script.src) newScript.src = script.src;
      if (script.text) newScript.text = script.text;
      if (script.type) newScript.type = script.type;
      script.parentNode.replaceChild(newScript, script);
    }
  }
}

export function loadScriptAsync(url: string): Promise<any> {
  return new Promise(function(resolve, reject) {
    var script = document.createElement('script');
    script.onload = () => resolve(url);
    script.onerror = () => reject(`Can't load script: "${url}".`);
    script.async = true;
    script.src = url;
    document.getElementsByTagName("head")[0].appendChild(script);
  });
}

export function collapsePath(path: string) {
  const parts = path.replace(/\/+/g, '/').split('/');
  const stack = [];
  for (const part of parts) {
    if (part === '.' || part === '') {
      continue;
    } else if (part === '..') {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join('/');
}
