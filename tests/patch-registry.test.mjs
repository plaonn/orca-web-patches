import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.mjs';

const OWP = loadModules(['src/version.js', 'src/patch-registry.js']);
const patch = OWP.patchRegistry.getPatch('force-linux-platform');

const windowsBrowser = { browserPlatform: 'Win32' };
const linuxBrowser = { browserPlatform: 'Linux x86_64' };

test('Linux runtime applies conservatively until an upstream fixed version is known', () => {
  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    patch,
    { platform: 'linux', appVersion: '1.4.188' },
    windowsBrowser
  ), true);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    patch,
    { platform: 'linux', appVersion: '9.9.9' },
    windowsBrowser
  ), true);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    patch,
    { platform: 'linux', appVersion: null },
    windowsBrowser
  ), true);
});

test('platform and capability probe both participate in automatic selection', () => {
  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    patch,
    { platform: 'win32', appVersion: '1.4.188' },
    windowsBrowser
  ), false);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    patch,
    { platform: 'darwin', appVersion: '1.4.188' },
    windowsBrowser
  ), false);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    patch,
    { platform: 'linux', appVersion: '1.4.188' },
    linuxBrowser
  ), false);

  const decision = OWP.patchRegistry.evaluatePatch(
    patch,
    { platform: 'linux', appVersion: '1.4.188' },
    windowsBrowser
  );
  assert.equal(decision.patchId, 'force-linux-platform');
  assert.equal(decision.selected, true);
  assert.equal(decision.reason, 'probe:browser-runtime-platform-mismatch:match');
});

test('unknown probe input preserves the patch-specific conservative policy', () => {
  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    patch,
    { platform: 'linux', appVersion: '1.4.188' },
    {}
  ), true);
  assert.equal(OWP.patchRegistry.evaluatePatch(
    patch,
    { platform: 'linux', appVersion: '1.4.188' },
    {}
  ).reason, 'probe:browser-runtime-platform-mismatch:unknown');
});

test('explicit semver ranges select only versions inside their boundaries', () => {
  const ranged = {
    ...patch,
    appliesTo: {
      ...patch.appliesTo,
      versionRange: { minInclusive: '1.4.180', maxExclusive: '1.5.0' },
      probe: null
    },
    applyUntilFixed: false,
    evidence: { ...patch.evidence, confirmedAffected: [] }
  };

  assert.equal(OWP.patchRegistry.shouldApplyPatch(ranged, { platform: 'linux', appVersion: '1.4.179' }), false);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(ranged, { platform: 'linux', appVersion: '1.4.180' }), true);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(ranged, { platform: 'linux', appVersion: '1.4.999' }), true);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(ranged, { platform: 'linux', appVersion: '1.5.0' }), false);
});

test('fixedIn retires valid versions at or above the fix without misclassifying malformed versions', () => {
  const withFix = { ...patch, evidence: { ...patch.evidence, fixedIn: '1.5.0' } };
  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    withFix,
    { platform: 'linux', appVersion: '1.4.999' },
    windowsBrowser
  ), true);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    withFix,
    { platform: 'linux', appVersion: '1.5.0' },
    windowsBrowser
  ), false);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    withFix,
    { platform: 'linux', appVersion: 'malformed' },
    windowsBrowser
  ), true);
});

test('selectPatches returns selected patches and explainable decisions for a phase', () => {
  const selection = OWP.patchRegistry.selectPatches(
    { platform: 'linux', appVersion: '1.4.188' },
    windowsBrowser,
    { phase: 'bootstrap' }
  );

  assert.equal(selection.selected.map((entry) => entry.id).join(','), 'force-linux-platform');
  assert.equal(selection.decisions.length, 1);
  assert.equal(selection.decisions[0].selected, true);
});
