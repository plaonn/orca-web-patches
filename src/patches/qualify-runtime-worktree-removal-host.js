((OWP) => {
  'use strict';

  const CALL_MARKER = '__orcaWebPatchesWorktreeRemovalHostQualificationV1';

  const patchState = {
    installed: false,
    rewrittenCallCount: 0,
    lastRewrittenSelector: null,
    lastRewrittenHostId: null,
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

  function installRuntimeCallBridge(windowObject) {
    const runtimeEnvironments = windowObject.api?.runtimeEnvironments;
    if (!runtimeEnvironments || typeof runtimeEnvironments.call !== 'function') {
      return { applied: false, reason: 'runtime-call-api-unavailable' };
    }
    if (runtimeEnvironments.call?.[CALL_MARKER] === true) {
      patchState.installed = true;
      return { applied: true, reason: 'already-installed' };
    }

    const originalCall = runtimeEnvironments.call;
    const wrappedCall = function qualifiedRuntimeCall(...args) {
      const qualified = qualifyCallRequest(args[0]);
      if (qualified.rewritten) {
        patchState.rewrittenCallCount += 1;
        patchState.lastRewrittenSelector = qualified.request.selector ?? null;
        patchState.lastRewrittenHostId = qualified.removedHostId ?? null;
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

    patchState.installed = true;
    return {
      applied: true,
      fields: ['runtimeEnvironments.call(worktree.rm.hostId)'],
      reason: 'installed'
    };
  }

  function applyQualifyRuntimeWorktreeRemovalHost(windowObject) {
    return installRuntimeCallBridge(windowObject);
  }

  OWP.qualifyRuntimeWorktreeRemovalHost = Object.freeze({
    parseRuntimeEnvironmentId,
    qualifyCallRequest,
    installRuntimeCallBridge,
    applyQualifyRuntimeWorktreeRemovalHost,
    getStatus: () => ({ ...patchState })
  });
})(globalThis.__OWP__);
