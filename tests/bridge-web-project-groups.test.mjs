import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, memoryStorage } from './helpers.mjs';

function freshPatchModules() {
  return loadModules([
    'src/constants.js',
    'src/runtime-profile.js',
    'src/patches/bridge-web-project-groups.js'
  ]);
}

function makeWindow({ withEnvironment = true, webClient = true } = {}) {
  const environment = {
    id: 'web-synthetic',
    preferredEndpointId: 'endpoint',
    endpoints: [{
      id: 'endpoint',
      endpoint: 'wss://runtime.invalid/socket',
      publicKeyB64: 'synthetic-public-key'
    }]
  };
  const localStorage = memoryStorage({
    ...(withEnvironment
      ? { 'orca.web.runtimeEnvironment.v1': JSON.stringify(environment) }
      : {})
  });
  const intervals = [];
  const fallbackNamespace = new Proxy(function projectGroupsFallback() {}, {
    get: (_target, property) => property === 'scanNested' ? 'fallback-scan' : undefined
  });
  const window = {
    __ORCA_WEB_CLIENT__: webClient,
    localStorage,
    api: { projectGroups: fallbackNamespace },
    setInterval: (callback) => {
      intervals.push(callback);
      return intervals.length;
    }
  };
  return { window, intervals, fallbackNamespace };
}

test('keeps the paired Web client-local project-group catalog empty', async () => {
  const OWP = freshPatchModules();
  const app = makeWindow();
  const result = OWP.bridgeWebProjectGroups.applyBridgeWebProjectGroups(app.window);
  assert.equal(result.applied, true);
  assert.deepEqual(await app.window.api.projectGroups.list(), []);

  const status = OWP.bridgeWebProjectGroups.getStatus();
  assert.equal(status.localListCallCount, 1);
  assert.equal(status.rejectedMutationCount, 0);
});

test('rejects project-group mutations that incorrectly reach the local route', async () => {
  const OWP = freshPatchModules();
  const app = makeWindow();
  OWP.bridgeWebProjectGroups.applyBridgeWebProjectGroups(app.window);

  for (const [method, args] of [
    ['create', { name: 'Group' }],
    ['update', { groupId: 'group-a', updates: { name: 'Renamed' } }],
    ['delete', { groupId: 'group-a' }],
    ['moveProject', { projectId: 'repo-a', groupId: 'group-a' }]
  ]) {
    await assert.rejects(
      () => app.window.api.projectGroups[method](args),
      new RegExp(`local route: ${method}`)
    );
  }

  const status = OWP.bridgeWebProjectGroups.getStatus();
  assert.equal(status.rejectedMutationCount, 4);
  assert.equal(status.lastRejectedMutation, 'moveProject');
});

test('preserves fallback behavior for project-group methods outside the bounded bridge', () => {
  const OWP = freshPatchModules();
  const app = makeWindow();
  OWP.bridgeWebProjectGroups.applyBridgeWebProjectGroups(app.window);
  assert.equal(app.window.api.projectGroups.scanNested, 'fallback-scan');
});

test('fails closed outside a paired Orca Web environment', () => {
  const OWP = freshPatchModules();
  assert.equal(
    OWP.bridgeWebProjectGroups.applyBridgeWebProjectGroups(makeWindow({ webClient: false }).window).applied,
    false
  );
  assert.equal(
    OWP.bridgeWebProjectGroups.applyBridgeWebProjectGroups(makeWindow({ withEnvironment: false }).window).applied,
    false
  );
});

test('rewraps projectGroups after Orca replaces the preload API object', async () => {
  const OWP = freshPatchModules();
  const app = makeWindow();
  OWP.bridgeWebProjectGroups.applyBridgeWebProjectGroups(app.window);
  assert.equal(app.intervals.length, 1);

  app.window.api = { projectGroups: app.fallbackNamespace };
  app.intervals[0]();

  assert.deepEqual(await app.window.api.projectGroups.list(), []);
  await assert.rejects(
    () => app.window.api.projectGroups.create({ name: 'Again' }),
    /local route: create/
  );
  const status = OWP.bridgeWebProjectGroups.getStatus();
  assert.equal(status.watcherInstalled, true);
  assert.equal(status.wrapCount >= 2, true);
});
