import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const sources = [
  'src/constants.js',
  'src/version.js',
  'src/runtime-profile.js',
  'src/patch-registry.js',
  'src/patches/align-browser-platform-to-runtime.js',
  'src/patches/bridge-web-runtime-settings.js',
  'src/patches/qualify-runtime-worktree-removal-host.js',
  'src/patches/fill-web-project-groups-api.js',
  'src/runtime-discovery.js',
  'src/main.js'
];

const header = `// ==UserScript==\n// @name         Orca Web Patches\n// @namespace    https://github.com/plaonn/orca-web-patches\n// @version      ${packageJson.version}\n// @description  Version-aware compatibility patches for Orca Web.\n// @license      MIT\n// @homepageURL  https://github.com/plaonn/orca-web-patches\n// @supportURL   https://github.com/plaonn/orca-web-patches/issues\n// @updateURL    https://raw.githubusercontent.com/plaonn/orca-web-patches/main/dist/orca-web-patches.user.js\n// @downloadURL  https://raw.githubusercontent.com/plaonn/orca-web-patches/main/dist/orca-web-patches.user.js\n// @match        http://localhost/*\n// @match        https://localhost/*\n// @match        http://127.0.0.1/*\n// @match        https://127.0.0.1/*\n// @run-at       document-start\n// @sandbox      raw\n// @grant        none\n// @noframes\n// ==/UserScript==\n`;

const body = [];
for (const source of sources) {
  const content = await fs.readFile(path.join(root, source), 'utf8');
  body.push(`\n  // ---- ${source} ----\n${content.replaceAll('globalThis.__OWP__', 'OWP').replace(/^/gm, '  ')}`);
}

const output = `${header}\n(() => {\n  'use strict';\n  const OWP = {};\n${body.join('\n')}\n})();\n`;
await fs.mkdir(path.join(root, 'dist'), { recursive: true });
await fs.writeFile(path.join(root, 'dist/orca-web-patches.user.js'), output, 'utf8');
console.log(`built dist/orca-web-patches.user.js (${Buffer.byteLength(output)} bytes)`);
