import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, memoryStorage } from './helpers.mjs';

function loadPatch() {
  return loadModules([
    'src/constants.js',
    'src/runtime-profile.js',
    'src/patches/fill-web-project-groups-api.js'
  ]);
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeWindow() {
  const calls = [];
  const intervals = [];
  const environment = {
    id: 'web-home',
    preferredEndpointId: 'endpoint',
    endpoints: [{ id: 'endpoint', endpoint: 'ws://example.invalid/', publicKeyB64: 'public' }]
  };
  const localStorage = memoryStorage({
    'orca.web.runtimeEnvironment.v1': JSON.stringify(environment)
  });
  const runtimeEnvironments = {
    call: async (request) => {
      calls.push(request);
      if (request.method === 'projectGroup.list') {
        return { ok: true, result: { groups: [{ id: 'g1', name: 'Existing' }] } };
      }
      if (request.method === 'projectGroup.create') {
        return { ok: true, result: { group: { id: 'g2', name: request.params.name } } };
      }
      if (request.method === 'projectGroup.update') {
        return { ok: true, result: { group: { id: request.params.groupId, ...request.params.updates } } };
      }
      if (request.method === 'projectGroup.delete') {
        return { ok: true, result: { deleted: true } };
      }
      if (request.method === 'projectGroup.moveProject') {
        return { ok: true, result: { repo: { id: request.params.repo, projectGroupId: request.params.groupId } } };
      }
      return { ok: false, error: { message: `unexpected method ${request.method}` } };
    }
  };
  const window = {
    localStorage,
    api: { runtimeEnvironments },
    setInterval: (callback) => {
      intervals.push(callback);
      return intervals.length;
    }
  };
  return { window, calls, intervals };
}

test('backfills projectGroups.create and returns the runtime-created group instead of undefined', async () => {
  const OWP = loadPatch();
  const app = makeWindow();
  const result = OWP.fillWebProjectGroupsApi.applyFillWebProjectGroupsApi(app.window);
  assert.equal(result.applied, true);

  const group = await app.window.api.projectGroups.create({
    name: 'My Group',
    createdFrom: 'manual'
  });

  assert.deepEqual(group, { id: 'g2', name: 'My Group' });
  assert.equal(app.calls.at(-1).selector, 'web-home');
  assert.equal(app.calls.at(-1).method, 'projectGroup.create');
  assert.deepEqual(normalize(app.calls.at(-1).params), { name: 'My Group', createdFrom: 'manual' });
  const status = OWP.fillWebProjectGroupsApi.getStatus();
  assert.equal(status.lastStatus, 'success');
  assert.equal(status.lastMethod, 'projectGroup.create');
});

test('maps the supported ProjectGroups preload contract to paired runtime RPCs', async () => {
  const OWP = loadPatch();
  const app = makeWindow();
  OWP.fillWebProjectGroupsApi.applyFillWebProjectGroupsApi(app.window);

  assert.deepEqual(await app.window.api.projectGroups.list(), [{ id: 'g1', name: 'Existing' }]);
  assert.deepEqual(
    await app.window.api.projectGroups.update({ groupId: 'g1', updates: { name: 'Renamed' } }),
    { id: 'g1', name: 'Renamed' }
  );
  assert.equal(await app.window.api.projectGroups.delete({ groupId: 'g1' }), true);
  assert.deepEqual(
    await app.window.api.projectGroups.moveProject({ projectId: 'repo-1', groupId: 'g2', order: 3 }),
    { id: 'repo-1', projectGroupId: 'g2' }
  );

  assert.deepEqual(
    app.calls.map((entry) => entry.method),
    ['projectGroup.list', 'projectGroup.update', 'projectGroup.delete', 'projectGroup.moveProject']
  );
  assert.deepEqual(normalize(app.calls.at(-1).params), { repo: 'repo-1', groupId: 'g2', order: 3 });
});

test('rewrap watcher restores the adapter after Orca replaces window.api', async () => {
  const OWP = loadPatch();
  const app = makeWindow();
  OWP.fillWebProjectGroupsApi.applyFillWebProjectGroupsApi(app.window);
  assert.equal(app.intervals.length, 1);

  const runtimeEnvironments = app.window.api.runtimeEnvironments;
  app.window.api = { runtimeEnvironments };
  assert.equal(app.window.api.projectGroups, undefined);

  app.intervals[0]();
  const group = await app.window.api.projectGroups.create({ name: 'After replace' });
  assert.equal(group.name, 'After replace');
  assert.equal(OWP.fillWebProjectGroupsApi.getStatus().adapterInstallCount, 2);
});

test('runtime errors are surfaced instead of returning undefined into the store', async () => {
  const OWP = loadPatch();
  const app = makeWindow();
  app.window.api.runtimeEnvironments.call = async () => ({
    ok: false,
    error: { message: 'project group create rejected' }
  });
  OWP.fillWebProjectGroupsApi.applyFillWebProjectGroupsApi(app.window);

  await assert.rejects(
    () => app.window.api.projectGroups.create({ name: 'Bad' }),
    /project group create rejected/
  );
  assert.equal(OWP.fillWebProjectGroupsApi.getStatus().lastStatus, 'error');
});
