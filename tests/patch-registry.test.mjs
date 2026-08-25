import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.mjs';

const OWP = loadModules(['src/version.js', 'src/patch-registry.js']);
const patch = OWP.patchRegistry.getPatch('align-browser-platform-to-runtime');

const windowsBrowser = { browserPlatform: 'Win32' };
const linuxBrowser = { browserPlatform: 'Linux x86_64' };
const macBrowser = { browserPlatform: 'MacIntel' };

test('verified affected browser/runtime pairs apply conservatively until an upstream fixed version is known', () => {
  for (const runtimePlatform of ['linux', 'darwin']) {
    assert.equal(OWP.patchRegistry.shouldApplyPatch(
      patch,
      { platform: runtimePlatform, appVersion: '1.4.188' },
      windowsBrowser
    ), true);
    assert.equal(OWP.patchRegistry.shouldApplyPatch(
      patch,
      { platform: runtimePlatform, appVersion: '9.9.9' },
      windowsBrowser
    ), true);
    assert.equal(OWP.patchRegistry.shouldApplyPatch(
      patch,
      { platform: runtimePlatform, appVersion: null },
      windowsBrowser
    ), true);
  }
});

test('runtime and browser platform evidence both constrain automatic selection', () => {
  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    patch,
    { platform: 'win32', appVersion: '1.4.188' },
    windowsBrowser
  ), false);
  assert.equal(OWP.patchRegistry.evaluatePatch(
    patch,
    { platform: 'win32', appVersion: '1.4.188' },
    windowsBrowser
  ).reason, 'runtime-platform-mismatch');

  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    patch,
    { platform: 'linux', appVersion: '1.4.188' },
    linuxBrowser
  ), false);
  assert.equal(OWP.patchRegistry.evaluatePatch(
    patch,
    { platform: 'linux', appVersion: '1.4.188' },
    linuxBrowser
  ).reason, 'browser-platform-mismatch');

  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    patch,
    { platform: 'darwin', appVersion: '1.4.188' },
    macBrowser
  ), false);
  assert.equal(OWP.patchRegistry.evaluatePatch(
    patch,
    { platform: 'darwin', appVersion: '1.4.188' },
    macBrowser
  ).reason, 'browser-platform-mismatch');

  for (const runtimePlatform of ['linux', 'darwin']) {
    const decision = OWP.patchRegistry.evaluatePatch(
      patch,
      { platform: runtimePlatform, appVersion: '1.4.188' },
      windowsBrowser
    );
    assert.equal(decision.patchId, 'align-browser-platform-to-runtime');
    assert.equal(decision.selected, true);
    assert.equal(decision.reason, 'probe:browser-runtime-platform-mismatch:match');
  }
});

test('unknown browser platform fails closed when the affected browser family is evidence-bound', () => {
  const decision = OWP.patchRegistry.evaluatePatch(
    patch,
    { platform: 'darwin', appVersion: '1.4.188' },
    {}
  );
  assert.equal(decision.selected, false);
  assert.equal(decision.reason, 'browser-platform-unknown');
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

  assert.equal(OWP.patchRegistry.shouldApplyPatch(ranged, { platform: 'linux', appVersion: '1.4.179' }, windowsBrowser), false);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(ranged, { platform: 'linux', appVersion: '1.4.180' }, windowsBrowser), true);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(ranged, { platform: 'darwin', appVersion: '1.4.999' }, windowsBrowser), true);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(ranged, { platform: 'darwin', appVersion: '1.5.0' }, windowsBrowser), false);
});

test('fixedIn retires valid versions at or above the fix without misclassifying malformed versions', () => {
  const withFix = { ...patch, evidence: { ...patch.evidence, fixedIn: '1.5.0' } };
  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    withFix,
    { platform: 'darwin', appVersion: '1.4.999' },
    windowsBrowser
  ), true);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    withFix,
    { platform: 'darwin', appVersion: '1.5.0' },
    windowsBrowser
  ), false);
  assert.equal(OWP.patchRegistry.shouldApplyPatch(
    withFix,
    { platform: 'darwin', appVersion: 'malformed' },
    windowsBrowser
  ), true);
});

test('selectPatches returns generic patch identity and explainable decisions for a phase', () => {
  const selection = OWP.patchRegistry.selectPatches(
    { platform: 'darwin', appVersion: '1.4.188' },
    windowsBrowser,
    { phase: 'bootstrap' }
  );

  assert.equal(selection.selected.map((entry) => entry.id).join(','), 'align-browser-platform-to-runtime');
  assert.equal(selection.decisions.length, 1);
  assert.equal(selection.decisions[0].selected, true);
});
