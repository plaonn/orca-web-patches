import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.mjs';

const OWP = loadModules(['src/constants.js', 'src/runtime-profile.js', 'src/runtime-discovery.js']);
const expected = { environmentId: 'web-synthetic', endpoint: 'ws://example.invalid/', publicKeyB64: 'public' };

function fakeWindow(api) {
  return {
    api: { runtimeEnvironments: api },
    setTimeout: (fn) => { fn(); return 1; }
  };
}

test('status hostPlatform is preferred when present', async () => {
  let fallbackCalled = false;
  const result = await OWP.runtimeDiscovery.discoverRuntime(fakeWindow({
    list: async () => [{ id: 'web-synthetic' }],
    getStatus: async () => ({ ok: true, result: { runtimeId: 'runtime-a', appVersion: '1.4.188', hostPlatform: 'linux' }, _meta: { runtimeId: 'runtime-a' } }),
    call: async () => { fallbackCalled = true; return { ok: true, result: { platform: 'win32' } }; }
  }), expected);
  assert.equal(result.ok, true);
  assert.equal(result.platform, 'linux');
  assert.equal(fallbackCalled, false);
});

test('host.platform fallback provides backend truth', async () => {
  const result = await OWP.runtimeDiscovery.discoverRuntime(fakeWindow({
    list: async () => [{ id: 'web-synthetic' }],
    getStatus: async () => ({ ok: true, result: { runtimeId: 'runtime-b', appVersion: '1.4.188' }, _meta: { runtimeId: 'runtime-b' } }),
    call: async ({ method }) => ({ ok: true, result: method === 'host.platform' ? { platform: 'win32' } : {} })
  }), expected);
  assert.equal(
    JSON.stringify(result),
    JSON.stringify({ ok: true, runtimeId: 'runtime-b', platform: 'win32', appVersion: '1.4.188' })
  );
});

test('unknown environment and malformed platform fail closed', async () => {
  const missing = await OWP.runtimeDiscovery.discoverRuntime(fakeWindow({
    list: async () => [], getStatus: async () => ({}), call: async () => ({})
  }), expected);
  assert.equal(missing.reason, 'runtime-environment-mismatch');

  const malformed = await OWP.runtimeDiscovery.discoverRuntime(fakeWindow({
    list: async () => [{ id: 'web-synthetic' }],
    getStatus: async () => ({ ok: true, result: { runtimeId: 'runtime-c' } }),
    call: async () => ({ ok: true, result: { platform: 'Windows' } })
  }), expected);
  assert.equal(malformed.reason, 'host-platform-invalid');
});
