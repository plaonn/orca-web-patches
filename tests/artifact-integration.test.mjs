import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { root, memoryStorage, installSyntheticBridgeTransport } from './helpers.mjs';

function executeArtifact({ profile, discovered }) {
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' });
  const artifact = fs.readFileSync(path.join(root, 'dist/orca-web-patches.user.js'), 'utf8');
  const environment = {
    id: 'web-artifact',
    preferredEndpointId: 'endpoint',
    endpoints: [{
      id: 'endpoint',
      endpoint: 'wss://synthetic.invalid/runtime',
      publicKeyB64: 'synthetic-public-key'
    }]
  };
  const localStorage = memoryStorage({
    'orca.web.runtimeEnvironment.v1': JSON.stringify(environment),
    ...(profile ? { 'orca.web.patches.runtimeProfile.v1': JSON.stringify(profile) } : {})
  });
  const sessionStorage = memoryStorage();
  let reloads = 0;

  class FakeNavigator {}
  Object.defineProperties(FakeNavigator.prototype, {
    platform: { configurable: true, get: () => 'Win32' },
    userAgent: {
      configurable: true,
      get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0'
    },
    appVersion: { configurable: true, get: () => '5.0 (Windows NT 10.0; Win64; x64)' }
  });
  const navigator = new FakeNavigator();
  const window = {
    localStorage,
    sessionStorage,
    navigator,
    location: { search: '', reload: () => { reloads += 1; } },
    console
  };
  installSyntheticBridgeTransport(window, {
    ok: true,
    runtimeId: discovered.runtimeId,
    platform: discovered.platform,
    appVersion: discovered.appVersion
  });
  const context = vm.createContext({
    window,
    navigator,
    console,
    Date,
    URLSearchParams,
    Proxy,
    Object,
    Set,
    Map,
    Promise,
    JSON,
    Number,
    String,
    RegExp,
    Array,
    Math,
    queueMicrotask,
    globalThis: null
  });
  context.globalThis = context;
  vm.runInContext(artifact, context, { filename: 'orca-web-patches.user.js' });
  return { window, navigator, localStorage, getReloads: () => reloads };
}

test('generated artifact patches Edge-like navigator and projects paired runtime authority for Linux', async () => {
  const app = executeArtifact({
    profile: {
      schemaVersion: 1,
      environmentId: 'web-artifact',
      endpoint: 'wss://synthetic.invalid/runtime',
      publicKeyB64: 'synthetic-public-key',
      runtimeId: 'runtime-linux',
      platform: 'linux',
      appVersion: '1.4.188',
      verifiedAt: Date.now()
    },
    discovered: { runtimeId: 'runtime-linux', platform: 'linux', appVersion: '1.4.188' }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.navigator.platform, 'Linux x86_64');
  assert.match(app.navigator.userAgent, /Edg\/151\.0\.0\.0/);
  const status = app.window.__orcaWebPatches.getStatus();
  assert.equal(status.bootstrapPatchApplied, true);
  assert.deepEqual(status.bootstrapSelectedPatchIds, ['align-browser-platform-to-runtime', 'project-paired-runtime-authority']);
  assert.equal(status.pairedRuntimeAuthority.installed, true);
  assert.equal('runtimeId' in (status.bootstrapProfile ?? {}), false);
  assert.equal('endpoint' in (status.bootstrapProfile ?? {}), false);
  assert.equal('publicKeyB64' in (status.bootstrapProfile ?? {}), false);
  assert.equal('runtimeId' in (status.lastDiscovery ?? {}), false);
  assert.equal(app.getReloads(), 0);
});

test('generated artifact patches Edge-like navigator and projects paired runtime authority for macOS', async () => {
  const app = executeArtifact({
    profile: {
      schemaVersion: 1,
      environmentId: 'web-artifact',
      endpoint: 'wss://synthetic.invalid/runtime',
      publicKeyB64: 'synthetic-public-key',
      runtimeId: 'runtime-mac',
      platform: 'darwin',
      appVersion: '1.4.188',
      verifiedAt: Date.now()
    },
    discovered: { runtimeId: 'runtime-mac', platform: 'darwin', appVersion: '1.4.188' }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.navigator.platform, 'MacIntel');
  assert.match(app.navigator.userAgent, /Macintosh; Intel Mac OS X 10_15_7/);
  assert.match(app.navigator.userAgent, /Edg\/151\.0\.0\.0/);
  const status = app.window.__orcaWebPatches.getStatus();
  assert.equal(status.bootstrapPatchApplied, true);
  assert.deepEqual(status.bootstrapSelectedPatchIds, ['align-browser-platform-to-runtime', 'project-paired-runtime-authority']);
  assert.equal(status.bootstrapPatchResults[0].reason, 'aligned');
  assert.equal(status.pairedRuntimeAuthority.installed, true);
  assert.equal(app.getReloads(), 0);
});

test('generated artifact leaves Windows browser identity unchanged while projecting paired runtime authority', async () => {
  const app = executeArtifact({
    profile: {
      schemaVersion: 1,
      environmentId: 'web-artifact',
      endpoint: 'wss://synthetic.invalid/runtime',
      publicKeyB64: 'synthetic-public-key',
      runtimeId: 'runtime-windows',
      platform: 'win32',
      appVersion: '1.4.188',
      verifiedAt: Date.now()
    },
    discovered: { runtimeId: 'runtime-windows', platform: 'win32', appVersion: '1.4.188' }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.navigator.platform, 'Win32');
  const status = app.window.__orcaWebPatches.getStatus();
  assert.equal(status.bootstrapPatchApplied, true);
  assert.deepEqual(status.bootstrapSelectedPatchIds, ['project-paired-runtime-authority']);
  assert.equal(status.pairedRuntimeAuthority.installed, true);
  assert.equal(app.getReloads(), 0);
});
