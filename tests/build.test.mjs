import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root } from './helpers.mjs';

test('build emits deterministic userscript metadata and contains no user-specific port policy', () => {
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' });
  const artifactPath = path.join(root, 'dist/orca-web-patches.user.js');
  const artifact = fs.readFileSync(artifactPath, 'utf8');
  const first = artifact;
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' });
  assert.equal(fs.readFileSync(artifactPath, 'utf8'), first);
  assert.match(artifact, /@version\s+0\.2\.2/);
  assert.match(artifact, /@license\s+MIT/);
  assert.match(artifact, /@run-at\s+document-start/);
  assert.match(artifact, /@sandbox\s+raw/);
  assert.match(artifact, /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/plaonn\/orca-web-patches\/main\/dist\/orca-web-patches\.user\.js/);
  assert.doesNotMatch(artifact, /:\d{4,5}\//);
});

test('source script version stays aligned with package version', () => {
  const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const constants = fs.readFileSync(path.join(root, 'src/constants.js'), 'utf8');
  assert.match(constants, new RegExp(`SCRIPT_VERSION: ['"]${packageVersion.replace(/\./g, '\\.')}['"]`));
});
