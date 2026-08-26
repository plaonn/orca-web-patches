import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.mjs';

const OWP = loadModules(['src/version.js', 'src/patch-registry.js']);
const settingsPatch = OWP.patchRegistry.getPatch('bridge-web-runtime-settings');
const projectGroupsPatch = OWP.patchRegistry.getPatch('bridge-web-project-groups');
const removalPatch = OWP.patchRegistry.getPatch('qualify-runtime-worktree-removal-host');

const expectedRuntimePatchIds = [
  'bridge-web-runtime-settings',
  'bridge-web-project-groups',
  'qualify-runtime-worktree-removal-host'
].join(',');

test('runtime compatibility patches select for confirmed Orca Web runtime versions independent of OS pair', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const selection = OWP.patchRegistry.selectPatches(
      { platform, appVersion: '1.4.188' },
      { browserPlatform: 'Win32' },
      { phase: 'runtime' }
    );
    assert.equal(selection.selected.map((entry) => entry.id).join(','), expectedRuntimePatchIds);
    assert.equal(selection.decisions.every((decision) => decision.selected), true);
  }
});

test('runtime patches remain active for valid versions until an upstream fixed release boundary is known', () => {
  for (const patch of [settingsPatch, projectGroupsPatch, removalPatch]) {
    assert.equal(
      OWP.patchRegistry.shouldApplyPatch(
        patch,
        { platform: 'linux', appVersion: '9.9.9' },
        { browserPlatform: 'Linux x86_64' }
      ),
      true
    );
  }
});

test('runtime patches fail closed when the Orca version is unknown', () => {
  for (const patch of [settingsPatch, projectGroupsPatch, removalPatch]) {
    const decision = OWP.patchRegistry.evaluatePatch(
      patch,
      { platform: 'linux', appVersion: null },
      { browserPlatform: 'Linux x86_64' }
    );
    assert.equal(decision.selected, false);
    assert.equal(decision.reason, 'version-unknown');
  }
});
