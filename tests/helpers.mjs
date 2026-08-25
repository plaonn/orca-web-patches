import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadModules(modulePaths, extras = {}) {
  const context = vm.createContext({
    console,
    Date,
    URLSearchParams,
    Proxy,
    Object,
    Set,
    Map,
    Promise,
    JSON,
    Number,
    String,
    RegExp,
    Array,
    Math,
    globalThis: null,
    ...extras
  });
  context.globalThis = context;
  context.__OWP__ = {};
  for (const relative of modulePaths) {
    vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), context, { filename: relative });
  }
  return context.__OWP__;
}

export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    dump: () => Object.fromEntries(map)
  };
}

export function installSyntheticBridgeTransport(windowObject, discoverPayload) {
  const listeners = new Set();
  windowObject.__ORCA_WEB_CLIENT__ = true;
  windowObject.document = {
    createElement: () => ({ textContent: '', remove() {} }),
    documentElement: { appendChild() {} }
  };
  windowObject.addEventListener = (type, listener) => {
    if (type === 'message') listeners.add(listener);
  };
  windowObject.removeEventListener = (type, listener) => {
    if (type === 'message') listeners.delete(listener);
  };
  windowObject.postMessage = (message) => {
    if (!message || message.channel !== 'orca-web-patches.runtime.v1' || message.type !== 'request') return;
    const payload = message.action === 'ping'
      ? { ok: true, kind: 'ready' }
      : typeof discoverPayload === 'function'
        ? discoverPayload(message)
        : discoverPayload;
    queueMicrotask(() => {
      const event = {
        source: windowObject,
        data: {
          channel: 'orca-web-patches.runtime.v1',
          type: 'response',
          requestId: message.requestId,
          payload
        }
      };
      for (const listener of [...listeners]) listener(event);
    });
  };
  windowObject.setTimeout = setTimeout;
  windowObject.clearTimeout = clearTimeout;
  return windowObject;
}
