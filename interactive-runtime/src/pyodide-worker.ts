import * as Comlink from 'comlink';
import { loadPyodide, PyodideInterface } from 'pyodide';
import { comlinkTransfer, imageBitmapTransfer, mapTransfer, proxyTransfer } from './pyodide-proxy';
import { PyProxy } from 'pyodide/ffi';

declare global {
  interface Window {
    pyodide?: PyodideInterfaceWorker;
  }
}

export type PyodideWorker = {
  init: typeof init;
}

export type PyodideInterfaceWorker = PyodideInterface & {
  _module: {
    PyProxy_getPtr: (obj: PyProxy) => number;
  };
  _FS: typeof FS;
}

const FS = {
  mkdir(path: string) {
    self.pyodide._FS.mkdir(path);
  },
  writeFile(path: string, data: ArrayBufferView) {
    self.pyodide._FS.writeFile(path, data);
  }
}

async function init(options) {
  self.pyodide = await loadPyodide(options) as PyodideInterfaceWorker;
  self.pyodide.registerComlink(Comlink);
  self.pyodide._FS = self.pyodide.FS;
  self.pyodide.FS = FS;
  Comlink.transferHandlers.set("PyProxy", proxyTransfer);
  Comlink.transferHandlers.set("Comlink", comlinkTransfer);
  Comlink.transferHandlers.set("ImageBitmap", imageBitmapTransfer);
  Comlink.transferHandlers.set("Map", mapTransfer);
  return Comlink.proxy(self.pyodide);
}

Comlink.expose({ init });
