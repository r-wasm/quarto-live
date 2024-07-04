import { PyProxy } from 'pyodide/ffi';
import * as Comlink from 'comlink';
import { replaceInObject } from './utils';
import { isImageBitmap } from './utils';

type ProxyMap = Map<any, any>;
type WireProxy = { _comlinkProxy: true, ptr: number};
type ContainsComlinkProxy = {};

export function isPyProxy(obj: {}): obj is PyProxy {
  return obj && obj[Symbol.toStringTag] == "PyProxy";
}

function isComlinkProxy(obj: {}): obj is Comlink.Remote<PyProxy> {
  return obj && !!obj[Comlink.createEndpoint];
}

function isWireProxy(obj: {}): obj is WireProxy {
  return obj && typeof obj === "object" && "_comlinkProxy" in obj && "ptr" in obj;
}

function isProxyMap(obj: {}): obj is ProxyMap {
  return obj && obj[Symbol.toStringTag] == "Map";
}

function containsComlinkProxy(obj: {}): obj is ContainsComlinkProxy {
  if (isComlinkProxy(obj)) {
    return true;
  }
  if (obj === null || obj === undefined || obj instanceof ArrayBuffer || ArrayBuffer.isView(obj)) {
    return false;
  }
  if (obj instanceof Array) {
    return obj.some((el) => containsComlinkProxy(el));
  }
  if (typeof obj == "object") {
    return Object.entries(obj).some(([_, val]) => containsComlinkProxy(val));
  }
}

const registry: { [key: number]: PyProxy } = {};

export const proxyTransfer: Comlink.TransferHandler<PyProxy, [MessagePort, number]> = {
  canHandle: isPyProxy,
  serialize(obj: PyProxy) {
    const ptr = self.pyodide._module.PyProxy_getPtr(obj);
    registry[ptr] = obj;
    const { port1, port2 } = new MessageChannel();
    Comlink.expose(obj, port1);
    return [[port2, ptr], [port2]];
  },
  deserialize([port, ptr]) {
    port.start();
    const wrap = Comlink.wrap<PyProxy>(port);
    const proxy = new Proxy(wrap, {
      get: (target, prop: string) => prop === "_ptr" ? ptr : target[prop]
    });
    return proxy as unknown as PyProxy;
  }
}

export const comlinkTransfer: Comlink.TransferHandler<ContainsComlinkProxy, any> = {
  canHandle: containsComlinkProxy,
  serialize(obj) {
    return [replaceInObject(obj, isComlinkProxy, (obj: Comlink.Remote<PyProxy>) => {
      return { _comlinkProxy: true, ptr: obj._ptr };
    }), []];
  },
  deserialize(wire) {
    return replaceInObject(wire, isWireProxy, (obj: WireProxy) => {
      return registry[obj.ptr];
    })
  }
}

export const imageBitmapTransfer: Comlink.TransferHandler<ImageBitmap, any> = {
  canHandle: isImageBitmap,
  serialize(obj) {
    // Empty plots can't be transferred! Make a 1x1 image, we'll ignore it later
    if (obj.width == 0 && obj.height == 0) {
      const offscreen = new OffscreenCanvas(1, 1);
      offscreen.getContext("2d");
      obj = offscreen.transferToImageBitmap();
    }
    return [obj, [obj]];
  },
  deserialize(obj) {
    return obj;
  }
}

export const mapTransfer: Comlink.TransferHandler<ProxyMap, any> = {
  canHandle: isProxyMap,
  serialize(obj) {
    return [Object.fromEntries(obj.entries()), []];
  },
  deserialize(wire) {
    return wire
  }
}
