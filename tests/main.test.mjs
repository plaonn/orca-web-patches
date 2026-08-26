import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { root, memoryStorage, installSyntheticBridgeTransport } from './helpers.mjs';

const modules = [
  'src/constants.js', 'src/version.js', 'src/runtime-profile.js', 'src/patch-registry.js',
  'src/patches/align-browser-platform-to-runtime.js', 'src/patches/bridge-web-runtime-settings.js',
  'src/patches/bridge-web-project-groups.js', 'src/patches/qualify-runtime-worktree-removal-host.js',
  'src/runtime-discovery.js', 'src/main.js'
];

const expectedRuntimePatchIds = [
  'bridge-web-runtime-settings',
  'bridge-web-project-groups',
  'qualify-runtime-worktree-removal-host'
];

function loadApp({ profile, discovered, browserPlatform = 'Win32' }) {
  const environment = {
    id: 'web-synthetic', preferredEndpointId: 'endpoint',
    endpoints: [{ id: 'endpoint', endpoint: 'ws://example.invalid/', publicKeyB64: 'public' }]
  };
  const localStorage = memoryStorage({
    'orca.web.runtimeEnvironment.v1': JSON.stringify(environment),
    ...(profile ? { 'orca.web.patches.runtimeProfile.v1': JSON.stringify(profile) } : {})
  });
  const sessionStorage = memoryStorage();
  let reloads = 0;
  class FakeNavigator {}
  const navigator = new FakeNavigator();
  Object.assign(navigator, {
    platform: browserPlatform,
    userAgent: browserPlatform.startsWith('Win')
      ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0'
      : browserPlatform.startsWith('Mac')
        ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0'
        : 'Mozilla/5.0 (X11; Linux x86_64) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0',
    appVersion: browserPlatform.startsWith('Win')
      ? '5.0 (Windows NT 10.0; Win64; x64)'
      : browserPlatform.startsWith('Mac')
        ? '5.0 (Macintosh; Intel Mac OS X 10_15_7)'
        : '5.0 (X11; Linux x86_64)'
  });
  const runtimeCalls = [];
  const window = {
    localStorage, sessionStorage, navigator,
    location: { search: '', reload: () => { reloads += 1; } },
    console,
    api: {
      settings: {
        set: async (updates) => updates
      },
      runtime: {
        call: async (request) => {
          runtimeCalls.push(request);
          return { ok: true, result: {} };
        }
      },
      runtimeEnvironments: {
        call: async (request) => {
          runtimeCalls.push(request);
          return { ok: true, result: {} };
        }
      }
    }
  };
  installSyntheticBridgeTransport(window, {
    ok: true,
    runtimeId: discovered.runtimeId,
    platform: discovered.platform,
    appVersion: discovered.appVersion
  });
  const context = vm.createContext({ console, Date, URLSearchParams, Proxy, Object, Set, Map, Promise, JSON, Number, String, RegExp, Array, Math, queueMicrotask, window, navigator, globalThis: null });
  context.globalThis = context;
  context.__OWP__ = {};
  for (const relative of modules) vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), context, { filename: relative });
  return { context, window, navigator, localStorage, sessionStorage, runtimeCalls, getReloads: () => reloads };
}

function assertRuntimePatchesInstalled(status) {
  assert.deepEqual(JSON.parse(JSON.stringify(status.runtimeSelectedPatchIds)), expectedRuntimePatchIds);
  assert.deepEqual(JSON.parse(JSON.stringify(status.runtimeAppliedPatchIds)), expectedRuntimePatchIds);
  assert.equal(status.runtimeSettingsBridge.storageObserverInstalled, true);
  assert.equal(status.projectGroupsBridge.installed, true);
  assert.equal(status.worktreeRemovalHostQualification.installed, true);
}

test('fresh verified Linux profile automatically selects and applies the generic alignment patch', async () => {
  const now = Date.now();
  const profile = {
    schemaVersion: 1, environmentId: 'web-synthetic', endpoint: 'ws://example.invalid/', publicKeyB64: 'public',
    runtimeId: 'runtime-a', platform: 'linux', appVersion: '1.4.188', verifiedAt: now
  };
  const app = loadApp({ profile, discovered: { runtimeId: 'runtime-a', platform: 'linux', appVersion: '1.4.188' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.navigator.platform, 'Linux x86_64');
  assert.equal(app.getReloads(), 0);

  const status = app.window.__orcaWebPatches.getStatus();
  assert.deepEqual(status.bootstrapSelectedPatchIds, ['align-browser-platform-to-runtime']);
  assert.deepEqual(status.bootstrapAppliedPatchIds, ['align-browser-platform-to-runtime']);
  assert.equal(status.bootstrapPatchResults[0].reason, 'aligned');
  assert.equal(status.patchDecisions[0].selected, true);
  assertRuntimePatchesInstalled(status);
});

test('fresh verified macOS profile automatically selects and applies the generic alignment patch', async () => {
  const now = Date.now();
  const profile = {
    schemaVersion: 1, environmentId: 'web-synthetic', endpoint: 'ws://example.invalid/', publicKeyB64: 'public',
    runtimeId: 'runtime-mac', platform: 'darwin', appVersion: '1.4.188', verifiedAt: now
  };
  const app = loadApp({ profile, discovered: { runtimeId: 'runtime-mac', platform: 'darwin', appVersion: '1.4.188' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.navigator.platform, 'MacIntel');
  assert.match(app.navigator.userAgent, /Macintosh; Intel Mac OS X 10_15_7/);
  assert.equal(app.getReloads(), 0);

  const status = app.window.__orcaWebPatches.getStatus();
  assert.deepEqual(status.bootstrapSelectedPatchIds, ['align-browser-platform-to-runtime']);
  assert.deepEqual(status.bootstrapAppliedPatchIds, ['align-browser-platform-to-runtime']);
  assert.equal(status.bootstrapPatchResults[0].reason, 'aligned');
  assert.equal(status.patchDecisions[0].selected, true);
  assertRuntimePatchesInstalled(status);
});

test('matching Linux browser/runtime skips an unnecessary alignment patch', async () => {
  const profile = {
    schemaVersion: 1, environmentId: 'web-synthetic', endpoint: 'ws://example.invalid/', publicKeyB64: 'public',
    runtimeId: 'runtime-a', platform: 'linux', appVersion: '1.4.188', verifiedAt: Date.now()
  };
  const app = loadApp({
    profile,
    discovered: { runtimeId: 'runtime-a', platform: 'linux', appVersion: '1.4.188' },
    browserPlatform: 'Linux x86_64'
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.navigator.platform, 'Linux x86_64');
  assert.equal(app.getReloads(), 0);

  const status = app.window.__orcaWebPatches.getStatus();
  assert.deepEqual(status.bootstrapSelectedPatchIds, []);
  assert.equal(status.bootstrapPatchApplied, false);
  assert.equal(status.patchDecisions[0].reason, 'browser-platform-mismatch');
  assertRuntimePatchesInstalled(status);
});

test('matching macOS browser/runtime skips an unnecessary alignment patch', async () => {
  const profile = {
    schemaVersion: 1, environmentId: 'web-synthetic', endpoint: 'ws://example.invalid/', publicKeyB64: 'public',
    runtimeId: 'runtime-mac', platform: 'darwin', appVersion: '1.4.188', verifiedAt: Date.now()
  };
  const app = loadApp({
    profile,
    discovered: { runtimeId: 'runtime-mac', platform: 'darwin', appVersion: '1.4.188' },
    browserPlatform: 'MacIntel'
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.navigator.platform, 'MacIntel');
  assert.equal(app.getReloads(), 0);

  const status = app.window.__orcaWebPatches.getStatus();
  assert.deepEqual(status.bootstrapSelectedPatchIds, []);
  assert.equal(status.bootstrapPatchApplied, false);
  assert.equal(status.patchDecisions[0].reason, 'browser-platform-mismatch');
  assertRuntimePatchesInstalled(status);
});

test('runtime removal patch strips the paired runtime host before forwarding worktree.rm', async () => {
  const profile = {
    schemaVersion: 1, environmentId: 'web-synthetic', endpoint: 'ws://example.invalid/', publicKeyB64: 'public',
    runtimeId: 'runtime-a', platform: 'linux', appVersion: '1.4.188', verifiedAt: Date.now()
  };
  const app = loadApp({ profile, discovered: { runtimeId: 'runtime-a', platform: 'linux', appVersion: '1.4.188' } });
  await new Promise((resolve) => setImmediate(resolve));
  app.runtimeCalls.length = 0;

  await app.window.api.runtimeEnvironments.call({
    selector: 'web-synthetic',
    method: 'worktree.rm',
    params: { worktree: 'id:repo::/tmp/worktree', hostId: 'runtime:web-synthetic' }
  });

  assert.equal(app.runtimeCalls.length, 1);
  assert.equal(app.runtimeCalls[0].params.hostId, undefined);
  assert.equal(app.window.__orcaWebPatches.getStatus().worktreeRemovalHostQualification.rewrittenCallCount, 1);
});

test('unknown first load does not mutate browser identity and requests one reload after macOS selection', async () => {
  const app = loadApp({ profile: null, discovered: { runtimeId: 'runtime-mac', platform: 'darwin', appVersion: '1.4.188' } });
  assert.equal(app.navigator.platform, 'Win32');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.getReloads(), 1);
  assert.equal(app.window.__orcaWebPatches.getStatus().patchDecisions[0].selected, true);
});

test('stale Linux cache corrected to Windows requests reload and next bootstrap will select no patch', async () => {
  const profile = {
    schemaVersion: 1, environmentId: 'web-synthetic', endpoint: 'ws://example.invalid/', publicKeyB64: 'public',
    runtimeId: 'runtime-old', platform: 'linux', appVersion: '1.4.188', verifiedAt: Date.now()
  };
  const app = loadApp({ profile, discovered: { runtimeId: 'runtime-new', platform: 'win32', appVersion: '1.4.188' } });
  assert.equal(app.navigator.platform, 'Linux x86_64');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.getReloads(), 1);
  const cached = JSON.parse(app.localStorage.getItem('orca.web.patches.runtimeProfile.v1'));
  assert.equal(cached.platform, 'win32');
  assert.deepEqual(app.window.__orcaWebPatches.getStatus().patchDecisions.map((entry) => entry.selected), [false]);
});
