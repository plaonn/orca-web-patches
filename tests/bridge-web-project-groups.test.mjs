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
  const calls = [];
  const intervals = [];
  const fallbackNamespace = new Proxy(function projectGroupsFallback() {}, {
    get: (_target, property) => property === 'scanNested' ? 'fallback-scan' : undefined
  });
  const makeRuntime = () => ({
    call: async (request) => {
      calls.push(request);
      if (request.method === 'projectGroup.list') {
        return { ok: true, result: { groups: [{ id: 'group-a', name: 'A' }] } };
      }
      if (request.method === 'projectGroup.create') {
        return {
          ok: true,
          result: { group: { id: 'group-new', name: request.params.name, connectionId: null } }
        };
      }
      if (request.method === 'projectGroup.update') {
        return {
          ok: true,
          result: { group: { id: request.params.groupId, ...request.params.updates } }
        };
      }
      if (request.method === 'projectGroup.delete') {
        return { ok: true, result: true };
      }
      if (request.method === 'projectGroup.moveProject') {
        return { ok: true, result: { repo: { id: request.params.repo } } };
      }
      return { ok: false, error: { message: `Unexpected method: ${request.method}` } };
    }
  });
  const window = {
    __ORCA_WEB_CLIENT__: webClient,
    localStorage,
    api: {
      runtime: makeRuntime(),
      projectGroups: fallbackNamespace
    },
    setInterval: (callback) => {
      intervals.push(callback);
      return intervals.length;
    }
  };
  return { window, calls, intervals, fallbackNamespace, makeRuntime };
}

test('bridges the basic project-group lifecycle through the paired runtime RPC transport', async () => {
  const OWP = freshPatchModules();
  const app = makeWindow();
  const result = OWP.bridgeWebProjectGroups.applyBridgeWebProjectGroups(app.window);
  assert.equal(result.applied, true);

  const createArgs = {
    name: 'Group',
    parentPath: null,
    parentGroupId: null,
    createdFrom: 'manual'
  };
  const created = await app.window.api.projectGroups.create(createArgs);
  assert.equal(created.id, 'group-new');
  assert.equal(created.connectionId, null);
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0])), {
    method: 'projectGroup.create',
    params: createArgs
  });

  const groups = await app.window.api.projectGroups.list();
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, 'group-a');

  const updated = await app.window.api.projectGroups.update({
    groupId: 'group-new',
    updates: { name: 'Renamed' }
  });
  assert.equal(updated.name, 'Renamed');

  assert.equal(await app.window.api.projectGroups.delete({ groupId: 'group-new' }), true);

  const moved = await app.window.api.projectGroups.moveProject({
    projectId: 'repo-a',
    groupId: 'group-a',
    order: 0
  });
  assert.equal(moved.id, 'repo-a');
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls.at(-1))), {
    method: 'projectGroup.moveProject',
    params: { repo: 'repo-a', groupId: 'group-a', order: 0 }
  });
});

test('preserves fallback behavior for project-group methods outside the bounded bridge', () => {
  const OWP = freshPatchModules();
  const app = makeWindow();
  OWP.bridgeWebProjectGroups.applyBridgeWebProjectGroups(app.window);
  assert.equal(app.window.api.projectGroups.scanNested, 'fallback-scan');
});

test('propagates runtime failures and rejects malformed success payloads instead of inventing results', async () => {
  const OWP = freshPatchModules();
  const app = makeWindow();
  OWP.bridgeWebProjectGroups.applyBridgeWebProjectGroups(app.window);

  app.window.api.runtime.call = async () => ({
    ok: false,
    error: { code: 'project_group_failed', message: 'runtime failed' }
  });
  await assert.rejects(
    () => app.window.api.projectGroups.create({ name: 'Broken' }),
    /runtime failed/
  );

  app.window.api.runtime.call = async () => ({ ok: true, result: {} });
  await assert.rejects(
    () => app.window.api.projectGroups.create({ name: 'Malformed' }),
    /invalid projectGroup\.create group/
  );
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

  app.window.api = {
    runtime: app.makeRuntime(),
    projectGroups: app.fallbackNamespace
  };
  app.intervals[0]();

  assert.equal(typeof app.window.api.projectGroups.create, 'function');
  assert.equal((await app.window.api.projectGroups.create({ name: 'Again' })).name, 'Again');
  const status = OWP.bridgeWebProjectGroups.getStatus();
  assert.equal(status.watcherInstalled, true);
  assert.equal(status.wrapCount >= 2, true);
});
