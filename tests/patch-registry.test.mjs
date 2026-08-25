import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.mjs';

const OWP = loadModules(['src/version.js', 'src/patch-registry.js']);
const patch = OWP.patchRegistry.getPatch('force-linux-platform');

test('Linux runtime applies conservatively until an upstream fixed version is known', () => {
  assert.equal(OWP.patchRegistry.shouldApplyPatch(patch, { platform: 'linux', appVersion: '1.4.188' }), true);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(patch, { platform: 'linux', appVersion: '9.9.9' }), true);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(patch, { platform: 'linux', appVersion: null }), true);
});

test('Windows and other non-Linux runtimes never receive the patch', () => {
  assert.equal(OWP.patchRegistry.shouldApplyPatch(patch, { platform: 'win32', appVersion: '1.4.188' }), false);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(patch, { platform: 'darwin', appVersion: '1.4.188' }), false);
});

test('fixedIn retires valid versions at or above the fix without misclassifying malformed versions', () => {
  const withFix = { ...patch, evidence: { ...patch.evidence, fixedIn: '1.5.0' } };
  assert.equal(OWP.patchRegistry.shouldApplyPatch(withFix, { platform: 'linux', appVersion: '1.4.999' }), true);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(withFix, { platform: 'linux', appVersion: '1.5.0' }), false);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(withFix, { platform: 'linux', appVersion: 'malformed' }), true);
});
