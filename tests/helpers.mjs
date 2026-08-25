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
