import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, memoryStorage } from './helpers.mjs';

function freshModules() {
  return loadModules([
    'src/constants.js',
    'src/patches/project-paired-runtime-authority.js'
  ]);
}

function makeWindow({ environmentId = 'web-synthetic', settings } = {}) {
  const initial = {};
  if (environmentId) {
    initial['orca.web.runtimeEnvironment.v1'] = JSON.stringify({
      id: environmentId,
      preferredEndpointId: 'endpoint',
      endpoints: [{ id: 'endpoint', endpoint: 'wss://runtime.invalid/', publicKeyB64: 'public' }]
    });
  }
  if (settings !== undefined) {
    initial['orca.web.settings.v1'] = typeof settings === 'string' ? settings : JSON.stringify(settings);
  }
  return { localStorage: memoryStorage(initial) };
}

test('projects the paired environment into settings reads without persisting it', () => {
  const OWP = freshModules();
  const window = makeWindow({ settings: { terminalFontSize: 15 } });
  const before = window.localStorage.dump()['orca.web.settings.v1'];

  const result = OWP.projectPairedRuntimeAuthority.applyProjectPairedRuntimeAuthority(window);
  assert.equal(result.applied, true);

  const visible = JSON.parse(window.localStorage.getItem('orca.web.settings.v1'));
  assert.equal(visible.activeRuntimeEnvironmentId, 'web-synthetic');
  assert.equal(visible.terminalFontSize, 15);
  assert.equal(window.localStorage.dump()['orca.web.settings.v1'], before);
});

test('projects authority when no web settings record exists', () => {
  const OWP = freshModules();
  const window = makeWindow();
  OWP.projectPairedRuntimeAuthority.applyProjectPairedRuntimeAuthority(window);
  assert.deepEqual(
    JSON.parse(window.localStorage.getItem('orca.web.settings.v1')),
    { activeRuntimeEnvironmentId: 'web-synthetic' }
  );
  assert.equal(window.localStorage.dump()['orca.web.settings.v1'], undefined);
});

test('preserves an explicit non-empty runtime preference', () => {
  const OWP = freshModules();
  const window = makeWindow({
    settings: { activeRuntimeEnvironmentId: 'explicit-environment', compactWorktreeCards: true }
  });
  OWP.projectPairedRuntimeAuthority.applyProjectPairedRuntimeAuthority(window);
  const visible = JSON.parse(window.localStorage.getItem('orca.web.settings.v1'));
  assert.equal(visible.activeRuntimeEnvironmentId, 'explicit-environment');
});

test('fails closed for malformed settings and unpaired storage', () => {
  const OWP = freshModules();
  const malformed = makeWindow({ settings: '{broken' });
  OWP.projectPairedRuntimeAuthority.applyProjectPairedRuntimeAuthority(malformed);
  assert.equal(malformed.localStorage.getItem('orca.web.settings.v1'), '{broken');

  const unpaired = makeWindow({ environmentId: null, settings: { terminalFontSize: 15 } });
  OWP.projectPairedRuntimeAuthority.applyProjectPairedRuntimeAuthority(unpaired);
  assert.deepEqual(
    JSON.parse(unpaired.localStorage.getItem('orca.web.settings.v1')),
    { terminalFontSize: 15 }
  );
});
