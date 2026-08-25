import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, memoryStorage } from './helpers.mjs';

const OWP = loadModules([
  'src/constants.js',
  'src/patches/qualify-runtime-worktree-removal-host.js'
]);

function makeWindow(environmentId = 'home-mac') {
  const runtimeCalls = [];
  const removeCalls = [];
  const intervals = [];
  const makeRuntimeEnvironments = () => ({
    call: async (request) => {
      runtimeCalls.push(request);
      return { ok: true, result: { removed: true } };
    }
  });
  const makeWorktrees = () => ({
    remove: async (args) => {
      removeCalls.push(args);
      return { removed: true };
    }
  });
  const localStorage = memoryStorage({
    'orca.web.runtimeEnvironment.v1': JSON.stringify({ id: environmentId })
  });
  const window = {
    api: {
      runtimeEnvironments: makeRuntimeEnvironments(),
      worktrees: makeWorktrees()
    },
    localStorage,
    setInterval: (callback) => {
      intervals.push(callback);
      return intervals.length;
    }
  };
  return {
    window,
    runtimeCalls,
    removeCalls,
    intervals,
    makeRuntimeEnvironments,
    makeWorktrees
  };
}

test('strips a runtime-local hostId from runtimeEnvironments worktree.rm exactly like current upstream', async () => {
  const app = makeWindow();
  const result = OWP.qualifyRuntimeWorktreeRemovalHost.applyQualifyRuntimeWorktreeRemovalHost(app.window);
  assert.equal(result.applied, true);

  await app.window.api.runtimeEnvironments.call({
    selector: 'home-mac',
    method: 'worktree.rm',
    params: {
      worktree: 'id:repo::/tmp/worktree',
      hostId: 'runtime:home-mac',
      force: false
    }
  });

  assert.equal(app.runtimeCalls.length, 1);
  assert.equal(app.runtimeCalls[0].params.hostId, undefined);
  assert.equal(app.runtimeCalls[0].params.worktree, 'id:repo::/tmp/worktree');
  assert.equal(app.runtimeCalls[0].params.force, false);
});

test('rewraps runtime removal APIs after Orca replaces its preload API objects', async () => {
  const app = makeWindow();
  OWP.qualifyRuntimeWorktreeRemovalHost.applyQualifyRuntimeWorktreeRemovalHost(app.window);
  assert.equal(app.intervals.length, 1);

  app.window.api.runtimeEnvironments = app.makeRuntimeEnvironments();
  app.window.api.worktrees = app.makeWorktrees();

  app.intervals[0]();

  await app.window.api.runtimeEnvironments.call({
    selector: 'home-mac',
    method: 'worktree.rm',
    params: {
      worktree: 'id:repo::/tmp/worktree',
      hostId: 'runtime:home-mac',
      force: true,
      runHooks: true
    }
  });

  assert.equal(app.runtimeCalls.at(-1).params.hostId, undefined);
  const status = OWP.qualifyRuntimeWorktreeRemovalHost.getStatus();
  assert.equal(status.watcherInstalled, true);
  assert.equal(status.runtimeCallWrapCount >= 2, true);
  assert.equal(status.rewrittenCallCount >= 1, true);
  assert.equal(status.lastRewriteSurface, 'runtimeEnvironments.call');
});

test('strips the paired runtime hostId from the 1.4.188 web worktrees.remove bypass route', async () => {
  const app = makeWindow();
  OWP.qualifyRuntimeWorktreeRemovalHost.applyQualifyRuntimeWorktreeRemovalHost(app.window);

  await app.window.api.worktrees.remove({
    worktreeId: 'repo::/tmp/worktree',
    hostId: 'runtime:home-mac',
    force: false,
    skipArchive: false
  });

  assert.equal(app.removeCalls.length, 1);
  assert.equal(app.removeCalls[0].hostId, undefined);
  assert.equal(app.removeCalls[0].worktreeId, 'repo::/tmp/worktree');
  assert.equal(app.removeCalls[0].force, false);
  const status = OWP.qualifyRuntimeWorktreeRemovalHost.getStatus();
  assert.equal(status.observedWorktreesRemoveCount >= 1, true);
  assert.equal(status.rewrittenWorktreesRemoveCount >= 1, true);
  assert.equal(status.lastRewrittenSelector, 'home-mac');
  assert.equal(status.lastRewrittenHostId, 'runtime:home-mac');
  assert.equal(status.lastRewriteSurface, 'worktrees.remove');
});

test('decodes runtime host ids before comparing them with the runtime selector', async () => {
  const app = makeWindow('home mac');
  OWP.qualifyRuntimeWorktreeRemovalHost.applyQualifyRuntimeWorktreeRemovalHost(app.window);

  await app.window.api.runtimeEnvironments.call({
    selector: 'home mac',
    method: 'worktree.rm',
    params: {
      worktree: 'id:repo::/tmp/worktree',
      hostId: 'runtime:home%20mac'
    }
  });
  await app.window.api.worktrees.remove({
    worktreeId: 'repo::/tmp/worktree',
    hostId: 'runtime:home%20mac'
  });

  assert.equal(app.runtimeCalls[0].params.hostId, undefined);
  assert.equal(app.removeCalls[0].hostId, undefined);
});

test('preserves SSH and other-runtime host qualification on both surfaces', async () => {
  const app = makeWindow();
  OWP.qualifyRuntimeWorktreeRemovalHost.applyQualifyRuntimeWorktreeRemovalHost(app.window);

  await app.window.api.runtimeEnvironments.call({
    selector: 'home-mac',
    method: 'worktree.rm',
    params: { worktree: 'id:a', hostId: 'ssh:server-a' }
  });
  await app.window.api.runtimeEnvironments.call({
    selector: 'home-mac',
    method: 'worktree.rm',
    params: { worktree: 'id:b', hostId: 'runtime:other-runtime' }
  });
  await app.window.api.worktrees.remove({ worktreeId: 'a', hostId: 'ssh:server-a' });
  await app.window.api.worktrees.remove({ worktreeId: 'b', hostId: 'runtime:other-runtime' });

  assert.equal(app.runtimeCalls[0].params.hostId, 'ssh:server-a');
  assert.equal(app.runtimeCalls[1].params.hostId, 'runtime:other-runtime');
  assert.equal(app.removeCalls[0].hostId, 'ssh:server-a');
  assert.equal(app.removeCalls[1].hostId, 'runtime:other-runtime');
});

test('leaves unrelated runtime RPC methods untouched', async () => {
  const app = makeWindow();
  OWP.qualifyRuntimeWorktreeRemovalHost.applyQualifyRuntimeWorktreeRemovalHost(app.window);

  await app.window.api.runtimeEnvironments.call({
    selector: 'home-mac',
    method: 'worktree.set',
    params: { worktree: 'id:a', hostId: 'runtime:home-mac' }
  });

  assert.equal(app.runtimeCalls[0].params.hostId, 'runtime:home-mac');
});

test('reports both supported interception surfaces and the rewrap watcher as installed', () => {
  const app = makeWindow();
  const result = OWP.qualifyRuntimeWorktreeRemovalHost.applyQualifyRuntimeWorktreeRemovalHost(app.window);
  assert.equal(result.applied, true);
  assert.equal(result.fields.includes('runtimeEnvironments.call(worktree.rm.hostId)'), true);
  assert.equal(result.fields.includes('worktrees.remove(hostId)'), true);
  assert.equal(result.fields.includes('runtime-removal-api-rewrap-watcher'), true);
});

test('fails closed when both removal APIs are unavailable', () => {
  const result = OWP.qualifyRuntimeWorktreeRemovalHost.applyQualifyRuntimeWorktreeRemovalHost({
    api: {},
    localStorage: memoryStorage()
  });
  assert.equal(result.applied, false);
  assert.match(result.reason, /runtime-call-api-unavailable/);
  assert.match(result.reason, /worktrees-remove-api-unavailable/);
});
