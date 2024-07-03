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
