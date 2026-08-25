import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.mjs';

const OWP = loadModules(['src/constants.js', 'src/runtime-profile.js', 'src/runtime-discovery.js']);
const expected = { environmentId: 'web-synthetic', endpoint: 'ws://example.invalid/', publicKeyB64: 'public' };

function fakeWindow(api, { ready = true } = {}) {
  return {
    __ORCA_WEB_CLIENT__: ready,
    api: { runtimeEnvironments: api },
    setTimeout: (fn) => { queueMicrotask(fn); return 1; },
    clearTimeout: () => {}
  };
}

test('status hostPlatform is preferred when present without enumerating environments', async () => {
  let listCalled = false;
  let fallbackCalled = false;
  const result = await OWP.runtimeDiscovery.discoverRuntime(fakeWindow({
    list: async () => { listCalled = true; return new Promise(() => {}); },
    getStatus: async ({ selector }) => ({
      ok: true,
      result: { runtimeId: 'runtime-a', appVersion: '1.4.188', hostPlatform: 'linux' },
      _meta: { runtimeId: 'runtime-a', selector }
    }),
    call: async () => { fallbackCalled = true; return { ok: true, result: { platform: 'win32' } }; }
  }), expected);
  assert.equal(result.ok, true);
  assert.equal(result.platform, 'linux');
  assert.equal(listCalled, false);
  assert.equal(fallbackCalled, false);
});

test('host.platform fallback provides backend truth using the persisted environment selector', async () => {
  let statusSelector = null;
  let platformSelector = null;
  const result = await OWP.runtimeDiscovery.discoverRuntime(fakeWindow({
    getStatus: async ({ selector }) => {
      statusSelector = selector;
      return { ok: true, result: { runtimeId: 'runtime-b', appVersion: '1.4.188' }, _meta: { runtimeId: 'runtime-b' } };
    },
    call: async ({ selector, method }) => {
      platformSelector = selector;
      return { ok: true, result: method === 'host.platform' ? { platform: 'win32' } : {} };
    }
  }), expected);
  assert.equal(
    JSON.stringify(result),
    JSON.stringify({ ok: true, runtimeId: 'runtime-b', platform: 'win32', appVersion: '1.4.188' })
  );
  assert.equal(statusSelector, 'web-synthetic');
  assert.equal(platformSelector, 'web-synthetic');
});

test('missing environment identity and malformed platform fail closed', async () => {
  const missing = await OWP.runtimeDiscovery.discoverRuntime(fakeWindow({
    getStatus: async () => ({}), call: async () => ({})
  }), null);
  assert.equal(missing.reason, 'runtime-environment-invalid');
  assert.equal(missing.stage, 'environment');

  const malformed = await OWP.runtimeDiscovery.discoverRuntime(fakeWindow({
    getStatus: async () => ({ ok: true, result: { runtimeId: 'runtime-c' } }),
    call: async () => ({ ok: true, result: { platform: 'Windows' } })
  }), expected);
  assert.equal(malformed.reason, 'host-platform-invalid');
  assert.equal(malformed.stage, 'platform');
});

test('runtime api readiness requires the installed Orca Web preload', async () => {
  const api = {
    getStatus: async () => ({}),
    call: async () => ({})
  };
  const pending = OWP.runtimeDiscovery.waitForRuntimeApi(fakeWindow(api, { ready: false }), 0);
  assert.equal(await pending, null);
  const ready = await OWP.runtimeDiscovery.waitForRuntimeApi(fakeWindow(api));
  assert.equal(typeof ready.getStatus, 'function');
  assert.equal(typeof ready.call, 'function');
});

test('hung runtime call is bounded by the userscript timeout wrapper', async () => {
  await assert.rejects(
    OWP.runtimeDiscovery.withTimeout(
      fakeWindow({}),
      () => new Promise(() => {}),
      1,
      'runtime-status'
    ),
    (error) => error?.code === 'OWP_RUNTIME_CALL_TIMEOUT'
  );
});
