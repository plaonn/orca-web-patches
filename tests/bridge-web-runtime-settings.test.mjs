import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, memoryStorage } from './helpers.mjs';

const OWP = loadModules([
  'src/constants.js',
  'src/runtime-profile.js',
  'src/patches/bridge-web-runtime-settings.js'
]);

function makeWindow({ storedSettings = {}, withEnvironment = true } = {}) {
  const environment = {
    id: 'web-synthetic',
    preferredEndpointId: 'endpoint',
    endpoints: [{ id: 'endpoint', endpoint: 'ws://example.invalid/', publicKeyB64: 'public' }]
  };
  const localStorage = memoryStorage({
    ...(withEnvironment
      ? { 'orca.web.runtimeEnvironment.v1': JSON.stringify(environment) }
      : {}),
    'orca.web.settings.v1': JSON.stringify(storedSettings)
  });
  const calls = [];
  const localSets = [];
  const settings = {
    set: async (updates) => {
      localSets.push(updates);
      return { ...storedSettings, ...updates };
    }
  };
  const runtimeEnvironments = {
    call: async (args) => {
      calls.push(args);
      return {
        ok: true,
        result: { settings: { ...args.params } },
        _meta: { runtimeId: 'runtime-a' }
      };
    }
  };
  return {
    window: { localStorage, api: { settings, runtimeEnvironments } },
    calls,
    localSets
  };
}

test('picks only runtime-supported settings omitted by the web forwarder', () => {
  const picked = OWP.bridgeWebRuntimeSettings.pickBridgedSettings({
    agentDefaultArgs: { codex: '--profile team' },
    defaultTuiAgent: 'codex',
    terminalFontSize: 16,
    compactWorktreeCards: true,
    prBotAuthorOverrides: ['bot']
  });

  assert.deepEqual(JSON.parse(JSON.stringify(picked)), {
    defaultTuiAgent: 'codex',
    agentDefaultArgs: { codex: '--profile team' }
  });
});

test('install syncs only explicitly persisted bridged web settings to the paired runtime', async () => {
  const app = makeWindow({
    storedSettings: {
      agentDefaultArgs: { codex: '--profile team' },
      agentDefaultEnv: { codex: { TEAM: 'alpha' } },
      terminalFontSize: 15
    }
  });

  const result = OWP.bridgeWebRuntimeSettings.applyBridgeWebRuntimeSettings(app.window);
  assert.equal(result.applied, true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].selector, 'web-synthetic');
  assert.equal(app.calls[0].method, 'settings.update');
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0].params)), {
    agentDefaultArgs: { codex: '--profile team' },
    agentDefaultEnv: { codex: { TEAM: 'alpha' } }
  });
});

test('settings.set forwards newly changed bridged settings after the normal web write', async () => {
  const app = makeWindow();
  OWP.bridgeWebRuntimeSettings.applyBridgeWebRuntimeSettings(app.window);
  await new Promise((resolve) => setImmediate(resolve));
  app.calls.length = 0;

  const updates = {
    defaultTuiAgent: 'claude',
    disabledTuiAgents: ['gemini'],
    terminalFontSize: 17
  };
  await app.window.api.settings.set(updates);

  assert.deepEqual(app.localSets, [updates]);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].method, 'settings.update');
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0].params)), {
    defaultTuiAgent: 'claude',
    disabledTuiAgents: ['gemini']
  });
});

test('explicit empty agent args are forwarded so the host cannot silently restore its own defaults', async () => {
  const app = makeWindow();
  OWP.bridgeWebRuntimeSettings.applyBridgeWebRuntimeSettings(app.window);
  await new Promise((resolve) => setImmediate(resolve));
  app.calls.length = 0;

  await app.window.api.settings.set({ agentDefaultArgs: { codex: '' } });

  assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0].params)), {
    agentDefaultArgs: { codex: '' }
  });
});

test('standalone/unpaired web settings remain local and do not require a runtime', async () => {
  const app = makeWindow({ withEnvironment: false });
  const result = OWP.bridgeWebRuntimeSettings.applyBridgeWebRuntimeSettings(app.window);
  assert.equal(result.applied, true);
  await app.window.api.settings.set({ defaultTaskViewPreset: 'my-issues' });
  assert.equal(app.calls.length, 0);
  assert.equal(app.localSets.length, 1);
});
