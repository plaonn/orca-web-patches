import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.mjs';

const OWP = loadModules(['src/version.js', 'src/patch-registry.js']);
const patch = OWP.patchRegistry.getPatch('bridge-web-runtime-settings');

test('runtime settings bridge selects for confirmed Orca Web runtime versions independent of OS pair', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const selection = OWP.patchRegistry.selectPatches(
      { platform, appVersion: '1.4.188' },
      { browserPlatform: 'Win32' },
      { phase: 'runtime' }
    );
    assert.deepEqual(selection.selected.map((entry) => entry.id), ['bridge-web-runtime-settings']);
    assert.equal(selection.decisions[0].selected, true);
  }
});

test('runtime settings bridge remains active for valid versions until an upstream fixed boundary is known', () => {
  assert.equal(
    OWP.patchRegistry.shouldApplyPatch(
      patch,
      { platform: 'linux', appVersion: '9.9.9' },
      { browserPlatform: 'Linux x86_64' }
    ),
    true
  );
});

test('runtime settings bridge fails closed when the Orca version is unknown', () => {
  const decision = OWP.patchRegistry.evaluatePatch(
    patch,
    { platform: 'linux', appVersion: null },
    { browserPlatform: 'Linux x86_64' }
  );
  assert.equal(decision.selected, false);
  assert.equal(decision.reason, 'version-unknown');
});
