import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, installSyntheticBridgeTransport } from './helpers.mjs';

const OWP = loadModules(['src/constants.js', 'src/runtime-profile.js', 'src/runtime-discovery.js']);
const expected = { environmentId: 'web-synthetic', endpoint: 'ws://example.invalid/', publicKeyB64: 'public' };

function fakeWindow(payload) {
  return installSyntheticBridgeTransport({}, payload);
}

test('page bridge returns verified Linux runtime without direct userscript RPC calls', async () => {
  const windowObject = fakeWindow({
    ok: true,
    runtimeId: 'runtime-a',
    platform: 'linux',
    appVersion: '1.4.188'
  });
  const result = await OWP.runtimeDiscovery.discoverRuntime(windowObject, expected);
  assert.equal(result.ok, true);
  assert.equal(result.platform, 'linux');
  assert.equal(result.transport, 'page-bridge');
});

test('page bridge preserves persisted environment selector in request', async () => {
  let selector = null;
  const windowObject = fakeWindow((message) => {
    selector = message.selector;
    return {
      ok: true,
      runtimeId: 'runtime-b',
      platform: 'win32',
      appVersion: '1.4.188'
    };
  });
  const result = await OWP.runtimeDiscovery.discoverRuntime(windowObject, expected);
  assert.equal(result.ok, true);
  assert.equal(result.platform, 'win32');
  assert.equal(selector, 'web-synthetic');
});

test('missing environment identity and malformed platform fail closed', async () => {
  const missing = await OWP.runtimeDiscovery.discoverRuntime(fakeWindow({}), null);
  assert.equal(missing.reason, 'runtime-environment-invalid');
  assert.equal(missing.stage, 'environment');

  const malformed = await OWP.runtimeDiscovery.discoverRuntime(fakeWindow({
    ok: true,
    runtimeId: 'runtime-c',
    platform: 'Windows',
    appVersion: '1.4.188'
  }), expected);
  assert.equal(malformed.reason, 'host-platform-invalid');
  assert.equal(malformed.stage, 'platform');
});

test('bridge injection contains page-realm Orca runtime calls', () => {
  let injected = '';
  const windowObject = {
    document: {
      createElement: () => ({ textContent: '', remove() {} }),
      documentElement: {
        appendChild: (script) => { injected = script.textContent; }
      }
    }
  };
  assert.equal(OWP.runtimeDiscovery.installPageBridge(windowObject), true);
  assert.match(injected, /runtimeEnvironments/);
  assert.match(injected, /getStatus/);
  assert.match(injected, /host\.platform/);
  assert.match(injected, /postMessage/);
});
