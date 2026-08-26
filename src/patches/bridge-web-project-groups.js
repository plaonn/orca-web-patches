((OWP) => {
  'use strict';

  const NAMESPACE_MARKER = '__orcaWebPatchesProjectGroupsBridgeV2';
  const REWRAP_INTERVAL_MS = 250;

  const patchState = {
    installed: false,
    watcherInstalled: false,
    wrapCount: 0,
    localListCallCount: 0,
    rejectedMutationCount: 0,
    lastRejectedMutation: null,
    lastError: null
  };

  let watcherHandle = null;
  let activeWindowObject = null;

  function readPairedEnvironment(windowObject) {
    if (windowObject?.__ORCA_WEB_CLIENT__ !== true) return null;
    try {
      return OWP.runtimeProfile.readCurrentEnvironment(windowObject.localStorage);
    } catch {
      return null;
    }
  }

  function rejectLocalMutation(method) {
    patchState.rejectedMutationCount += 1;
    patchState.lastRejectedMutation = method;
    const error = new Error(
      `Paired Orca Web project-group mutation reached the local route: ${method}`
    );
    patchState.lastError = error.message;
    throw error;
  }

  function createProjectGroupsBridge(fallbackNamespace) {
    const bridge = {
      list: async () => {
        patchState.localListCallCount += 1;
        return [];
      },
      create: async () => rejectLocalMutation('create'),
      update: async () => rejectLocalMutation('update'),
      delete: async () => rejectLocalMutation('delete'),
      moveProject: async () => rejectLocalMutation('moveProject')
    };
    Object.defineProperty(bridge, NAMESPACE_MARKER, { value: true });

    return new Proxy(bridge, {
      get(target, property, receiver) {
        if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
        return fallbackNamespace?.[property];
      }
    });
  }

  function installProjectGroupsBridge(windowObject) {
    if (windowObject?.__ORCA_WEB_CLIENT__ !== true) {
      patchState.installed = false;
      return { applied: false, reason: 'not-orca-web-client' };
    }
    if (!readPairedEnvironment(windowObject)) {
      patchState.installed = false;
      return { applied: false, reason: 'runtime-environment-unavailable' };
    }
    if (!windowObject.api) {
      patchState.installed = false;
      return { applied: false, reason: 'orca-api-unavailable' };
    }
    if (windowObject.api.projectGroups?.[NAMESPACE_MARKER] === true) {
      patchState.installed = true;
      return { applied: true, reason: 'already-installed' };
    }

    const fallbackNamespace = windowObject.api.projectGroups;
    const bridge = createProjectGroupsBridge(fallbackNamespace);
    try {
      windowObject.api.projectGroups = bridge;
    } catch {
      // Fall through to defineProperty for stricter preload proxy surfaces.
    }
    if (windowObject.api.projectGroups !== bridge) {
      try {
        Object.defineProperty(windowObject.api, 'projectGroups', {
          value: bridge,
          configurable: true,
          writable: true
        });
      } catch {
        patchState.installed = false;
        return { applied: false, reason: 'project-groups-api-not-writable' };
      }
    }

    patchState.installed = true;
    patchState.wrapCount += 1;
    return { applied: true, reason: 'installed' };
  }

  function ensureCurrentBridge(windowObject = activeWindowObject) {
    if (!windowObject) return { applied: false, reason: 'window-unavailable' };
    return installProjectGroupsBridge(windowObject);
  }

  function installWatcher(windowObject) {
    activeWindowObject = windowObject;
    if (watcherHandle !== null) {
      patchState.watcherInstalled = true;
      return true;
    }
    if (typeof windowObject.setInterval !== 'function') return false;
    watcherHandle = windowObject.setInterval(() => {
      try {
        ensureCurrentBridge(windowObject);
      } catch (error) {
        patchState.lastError = error instanceof Error ? error.message : String(error);
      }
    }, REWRAP_INTERVAL_MS);
    patchState.watcherInstalled = true;
    return true;
  }

  function applyBridgeWebProjectGroups(windowObject) {
    activeWindowObject = windowObject;
    const installed = ensureCurrentBridge(windowObject);
    installWatcher(windowObject);
    return {
      applied: installed.applied,
      fields: [
        ...(installed.applied ? ['projectGroups.list(empty-local-catalog)', 'projectGroups.local-mutations(fail-closed)'] : []),
        ...(patchState.watcherInstalled ? ['project-groups-api-rewrap-watcher'] : [])
      ],
      reason: installed.reason
    };
  }

  OWP.bridgeWebProjectGroups = Object.freeze({
    readPairedEnvironment,
    rejectLocalMutation,
    createProjectGroupsBridge,
    installProjectGroupsBridge,
    ensureCurrentBridge,
    applyBridgeWebProjectGroups,
    getStatus: () => {
      try {
        ensureCurrentBridge();
      } catch {
        // Diagnostics must remain readable while Orca swaps its preload API.
      }
      return { ...patchState };
    }
  });
})(globalThis.__OWP__);
