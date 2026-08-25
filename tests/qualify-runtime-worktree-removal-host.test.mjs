import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.mjs';

const OWP = loadModules(['src/patches/qualify-runtime-worktree-removal-host.js']);

function makeWindow() {
  const calls = [];
  const runtimeEnvironments = {
    call: async (request) => {
      calls.push(request);
      return { ok: true, result: { removed: true } };
    }
  };
  return { window: { api: { runtimeEnvironments } }, calls };
}

test('strips a runtime-local hostId from paired worktree.rm exactly like current upstream', async () => {
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

  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].params.hostId, undefined);
  assert.equal(app.calls[0].params.worktree, 'id:repo::/tmp/worktree');
  assert.equal(app.calls[0].params.force, false);
  const status = OWP.qualifyRuntimeWorktreeRemovalHost.getStatus();
  assert.equal(status.rewrittenCallCount, 1);
  assert.equal(status.lastRewrittenSelector, 'home-mac');
  assert.equal(status.lastRewrittenHostId, 'runtime:home-mac');
});

test('decodes runtime host ids before comparing them with the runtime selector', async () => {
  const app = makeWindow();
  OWP.qualifyRuntimeWorktreeRemovalHost.applyQualifyRuntimeWorktreeRemovalHost(app.window);

  await app.window.api.runtimeEnvironments.call({
    selector: 'home mac',
    method: 'worktree.rm',
    params: {
      worktree: 'id:repo::/tmp/worktree',
      hostId: 'runtime:home%20mac'
    }
  });

  assert.equal(app.calls[0].params.hostId, undefined);
});

test('preserves SSH and other-runtime host qualification', async () => {
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

  assert.equal(app.calls[0].params.hostId, 'ssh:server-a');
  assert.equal(app.calls[1].params.hostId, 'runtime:other-runtime');
});

test('leaves unrelated runtime RPC methods untouched', async () => {
  const app = makeWindow();
  OWP.qualifyRuntimeWorktreeRemovalHost.applyQualifyRuntimeWorktreeRemovalHost(app.window);

  await app.window.api.runtimeEnvironments.call({
    selector: 'home-mac',
    method: 'worktree.set',
    params: { worktree: 'id:a', hostId: 'runtime:home-mac' }
  });

  assert.equal(app.calls[0].params.hostId, 'runtime:home-mac');
});

test('fails closed when the runtime call API is unavailable', () => {
  const result = OWP.qualifyRuntimeWorktreeRemovalHost.applyQualifyRuntimeWorktreeRemovalHost({ api: {} });
  assert.equal(result.applied, false);
  assert.equal(result.reason, 'runtime-call-api-unavailable');
});
