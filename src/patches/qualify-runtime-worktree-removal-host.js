((OWP) => {
  'use strict';

  const CALL_MARKER = '__orcaWebPatchesWorktreeRemovalHostQualificationV1';
  const REMOVE_MARKER = '__orcaWebPatchesWorktreeRemoveQualificationV1';

  const patchState = {
    installed: false,
    runtimeCallWrapped: false,
    worktreesRemoveWrapped: false,
    observedRuntimeCallCount: 0,
    observedWorktreesRemoveCount: 0,
    rewrittenCallCount: 0,
    rewrittenWorktreesRemoveCount: 0,
    lastRewrittenSelector: null,
    lastRewrittenHostId: null,
    lastRewriteSurface: null,
    lastError: null
  };

  function parseRuntimeEnvironmentId(hostId) {
    if (typeof hostId !== 'string' || !hostId.startsWith('runtime:')) return null;
    const encoded = hostId.slice('runtime:'.length);
    if (!encoded) return null;
    try {
      const decoded = decodeURIComponent(encoded);
      return decoded || null;
    } catch {
      return null;
    }
  }

  function readActiveEnvironmentId(windowObject) {
    try {
      const raw = windowObject.localStorage?.getItem?.(OWP.constants.ORCA_ENVIRONMENT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed?.id === 'string' && parsed.id.trim() ? parsed.id.trim() : null;
    } catch {
      return null;
    }
  }

  function qualifyCallRequest(request) {
    if (!request || typeof request !== 'object' || request.method !== 'worktree.rm') {
      return { request, rewritten: false };
    }
    if (!request.params || typeof request.params !== 'object') {
      return { request, rewritten: false };
    }

    const runtimeEnvironmentId = parseRuntimeEnvironmentId(request.params.hostId);
    if (!runtimeEnvironmentId || runtimeEnvironmentId !== request.selector) {
      return { request, rewritten: false };
    }

    const params = { ...request.params };
    const removedHostId = params.hostId;
    delete params.hostId;
    return {
      request: { ...request, params },
      rewritten: true,
      removedHostId
    };
  }

  function qualifyWorktreesRemoveArgs(windowObject, args) {
    if (!args || typeof args !== 'object') return { args, rewritten: false };
    const activeEnvironmentId = readActiveEnvironmentId(windowObject);
    const runtimeEnvironmentId = parseRuntimeEnvironmentId(args.hostId);
    if (!activeEnvironmentId || !runtimeEnvironmentId || runtimeEnvironmentId !== activeEnvironmentId) {
      return { args, rewritten: false };
    }

    const nextArgs = { ...args };
    const removedHostId = nextArgs.hostId;
    delete nextArgs.hostId;
    return {
      args: nextArgs,
      rewritten: true,
      removedHostId,
      selector: activeEnvironmentId
    };
  }

  function wrapRuntimeCall(windowObject) {
    const runtimeEnvironments = windowObject.api?.runtimeEnvironments;
    if (!runtimeEnvironments || typeof runtimeEnvironments.call !== 'function') {
      return { applied: false, reason: 'runtime-call-api-unavailable' };
    }
    if (runtimeEnvironments.call?.[CALL_MARKER] === true) {
      patchState.runtimeCallWrapped = true;
      return { applied: true, reason: 'already-installed' };
    }

    const originalCall = runtimeEnvironments.call;
    const wrappedCall = function qualifiedRuntimeCall(...args) {
      patchState.observedRuntimeCallCount += 1;
      const qualified = qualifyCallRequest(args[0]);
      if (qualified.rewritten) {
        patchState.rewrittenCallCount += 1;
        patchState.lastRewrittenSelector = qualified.request.selector ?? null;
        patchState.lastRewrittenHostId = qualified.removedHostId ?? null;
        patchState.lastRewriteSurface = 'runtimeEnvironments.call';
        args[0] = qualified.request;
      }
      try {
        return Reflect.apply(originalCall, runtimeEnvironments, args);
      } catch (error) {
        patchState.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    };
    Object.defineProperty(wrappedCall, CALL_MARKER, { value: true });

    try {
      runtimeEnvironments.call = wrappedCall;
    } catch {
      // Fall through to defineProperty for stricter preload surfaces.
    }
    if (runtimeEnvironments.call !== wrappedCall) {
      try {
        Object.defineProperty(runtimeEnvironments, 'call', {
          value: wrappedCall,
          configurable: true,
          writable: true
        });
      } catch {
        return { applied: false, reason: 'runtime-call-not-writable' };
      }
    }

    patchState.runtimeCallWrapped = true;
    return { applied: true, reason: 'installed' };
  }

  function wrapWorktreesRemove(windowObject) {
    const worktrees = windowObject.api?.worktrees;
    if (!worktrees || typeof worktrees.remove !== 'function') {
      return { applied: false, reason: 'worktrees-remove-api-unavailable' };
    }
    if (worktrees.remove?.[REMOVE_MARKER] === true) {
      patchState.worktreesRemoveWrapped = true;
      return { applied: true, reason: 'already-installed' };
    }

    const originalRemove = worktrees.remove;
    const wrappedRemove = function qualifiedWorktreesRemove(...args) {
      patchState.observedWorktreesRemoveCount += 1;
      const qualified = qualifyWorktreesRemoveArgs(windowObject, args[0]);
      if (qualified.rewritten) {
        patchState.rewrittenWorktreesRemoveCount += 1;
        patchState.lastRewrittenSelector = qualified.selector ?? null;
        patchState.lastRewrittenHostId = qualified.removedHostId ?? null;
        patchState.lastRewriteSurface = 'worktrees.remove';
        args[0] = qualified.args;
      }
      try {
        return Reflect.apply(originalRemove, worktrees, args);
      } catch (error) {
        patchState.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    };
    Object.defineProperty(wrappedRemove, REMOVE_MARKER, { value: true });

    try {
      worktrees.remove = wrappedRemove;
    } catch {
      // Fall through to defineProperty for stricter preload surfaces.
    }
    if (worktrees.remove !== wrappedRemove) {
      try {
        Object.defineProperty(worktrees, 'remove', {
          value: wrappedRemove,
          configurable: true,
          writable: true
        });
      } catch {
        return { applied: false, reason: 'worktrees-remove-not-writable' };
      }
    }

    patchState.worktreesRemoveWrapped = true;
    return { applied: true, reason: 'installed' };
  }

  function installRuntimeRemovalQualification(windowObject) {
    const runtimeResult = wrapRuntimeCall(windowObject);
    const removeResult = wrapWorktreesRemove(windowObject);
    const applied = runtimeResult.applied || removeResult.applied;
    patchState.installed = applied;
    return {
      applied,
      fields: [
        ...(runtimeResult.applied ? ['runtimeEnvironments.call(worktree.rm.hostId)'] : []),
        ...(removeResult.applied ? ['worktrees.remove(hostId)'] : [])
      ],
      reason: applied ? 'installed' : `${runtimeResult.reason};${removeResult.reason}`
    };
  }

  function applyQualifyRuntimeWorktreeRemovalHost(windowObject) {
    return installRuntimeRemovalQualification(windowObject);
  }

  OWP.qualifyRuntimeWorktreeRemovalHost = Object.freeze({
    parseRuntimeEnvironmentId,
    readActiveEnvironmentId,
    qualifyCallRequest,
    qualifyWorktreesRemoveArgs,
    wrapRuntimeCall,
    wrapWorktreesRemove,
    installRuntimeRemovalQualification,
    applyQualifyRuntimeWorktreeRemovalHost,
    getStatus: () => ({ ...patchState })
  });
})(globalThis.__OWP__);
