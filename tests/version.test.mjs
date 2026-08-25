import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.mjs';

const OWP = loadModules(['src/version.js']);

test('semver parses stable and prerelease values', () => {
  assert.equal(OWP.versioning.parseSemver('1.4.188').patch, 188);
  assert.deepEqual(Array.from(OWP.versioning.parseSemver('1.5.0-rc.2').prerelease), ['rc', '2']);
  assert.equal(OWP.versioning.parseSemver('unknown'), null);
});

test('semver comparison is deterministic and malformed values fail closed', () => {
  assert.equal(OWP.versioning.compareSemver('1.4.188', '1.4.189'), -1);
  assert.equal(OWP.versioning.compareSemver('1.5.0-rc.1', '1.5.0'), -1);
  assert.equal(OWP.versioning.compareSemver('1.5.0', '1.5.0'), 0);
  assert.equal(OWP.versioning.compareSemver('garbage', '1.5.0'), null);
});
