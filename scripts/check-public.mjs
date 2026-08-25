import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbidden = [
  { label: 'hard-coded local port', re: /(?:localhost|127\.0\.0\.1):\d+/i },
  { label: 'Todoist-like ID', re: /\b6[gh][A-Za-z0-9]{14,20}\b/ },
  { label: 'macOS user path', re: /\/Users\/[^/]+\// },
  { label: 'Windows user path', re: /[A-Za-z]:\\Users\\[^\\]+\\/ },
  { label: 'secret-looking assignment', re: /(?:token|secret|password)\s*[:=]\s*['"][A-Za-z0-9_\-/.+=]{16,}['"]/i }
];
const allowedDirs = ['src', 'scripts', 'tests', 'docs', 'dist'];
const files = ['README.md', 'AGENTS.md', 'package.json', '.gitignore'];

async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else files.push(path.relative(root, full));
  }
}

for (const dir of allowedDirs) await walk(path.join(root, dir));
const violations = [];
for (const file of [...new Set(files)]) {
  const full = path.join(root, file);
  let content;
  try { content = await fs.readFile(full, 'utf8'); } catch { continue; }
  for (const rule of forbidden) {
    if (rule.re.test(content)) violations.push(`${file}: ${rule.label}`);
  }
}
if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log(`public-safety check passed (${new Set(files).size} files)`);
