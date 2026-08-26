((OWP) => {
  'use strict';

  const NAMESPACE_MARKER = '__orcaWebPatchesProjectGroupsBridgeV1';
  const REWRAP_INTERVAL_MS = 250;

  const patchState = {
    installed: false,
    watcherInstalled: false,
    wrapCount: 0,
    observedCallCount: 0,
    lastMethod: null,
    lastError: null
  };

  let watcherHandle = null;
  let activeWindowObject = null;

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function readPairedEnvironment(windowObject) {
    if (windowObject?.__ORCA_WEB_CLIENT__ !== true) return null;
    try {
      return OWP.runtimeProfile.readCurrentEnvironment(windowObject.localStorage);
    } catch {
      return null;
    }
  }

  function runtimeErrorMessage(response, method) {
    if (response?.ok === false) {
      if (typeof response.error?.message === 'string' && response.error.message) {
        return response.error.message;
      }
      if (typeof response.error === 'string' && response.error) return response.error;
      return `Orca runtime RPC failed: ${method}`;
    }
    return `Orca runtime RPC returned an invalid response: ${method}`;
  }

  async function callRuntimeResult(windowObject, method, params) {
    if (!readPairedEnvironment(windowObject)) {
      throw new Error('Paired Orca Web runtime environment is unavailable');
    }
    const runtime = windowObject.api?.runtime;
    if (typeof runtime?.call !== 'function') {
      throw new Error('Orca Web runtime API is unavailable');
    }

    patchState.observedCallCount += 1;
    patchState.lastMethod = method;
    patchState.lastError = null;

    try {
      const response = await runtime.call({ method, params });
      if (!response || response.ok !== true || !Object.hasOwn(response, 'result')) {
        throw new Error(runtimeErrorMessage(response, method));
      }
      return response.result;
    } catch (error) {
      patchState.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  function requireRecord(value, label) {
    if (!isRecord(value)) throw new Error(`Orca runtime RPC returned invalid ${label}`);
    return value;
  }

  function createProjectGroupsBridge(windowObject, fallbackNamespace) {
    const bridge = {
      list: async () => {
        const result = requireRecord(
          await callRuntimeResult(windowObject, 'projectGroup.list', undefined),
          'projectGroup.list result'
        );
        if (!Array.isArray(result.groups)) {
          throw new Error('Orca runtime RPC returned invalid projectGroup.list groups');
        }
        return result.groups;
      },
      create: async (args) => {
        const result = requireRecord(
          await callRuntimeResult(windowObject, 'projectGroup.create', args),
          'projectGroup.create result'
        );
        return requireRecord(result.group, 'projectGroup.create group');
      },
      update: async ({ groupId, updates }) => {
        const result = requireRecord(
          await callRuntimeResult(windowObject, 'projectGroup.update', { groupId, updates }),
          'projectGroup.update result'
        );
        if (result.group !== null && !isRecord(result.group)) {
          throw new Error('Orca runtime RPC returned invalid projectGroup.update group');
        }
        return result.group;
      },
      delete: async ({ groupId }) => {
        const result = await callRuntimeResult(windowObject, 'projectGroup.delete', { groupId });
        if (typeof result !== 'boolean') {
          throw new Error('Orca runtime RPC returned invalid projectGroup.delete result');
        }
        return result;
      },
      moveProject: async ({ projectId, groupId, order }) => {
        const params = { repo: projectId, groupId };
        if (order !== undefined) params.order = order;
        const result = requireRecord(
          await callRuntimeResult(windowObject, 'projectGroup.moveProject', params),
          'projectGroup.moveProject result'
        );
        if (result.repo !== null && !isRecord(result.repo)) {
          throw new Error('Orca runtime RPC returned invalid projectGroup.moveProject repo');
        }
        return result.repo;
      }
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
    if (typeof windowObject.api?.runtime?.call !== 'function') {
      patchState.installed = false;
      return { applied: false, reason: 'runtime-call-api-unavailable' };
    }
    if (windowObject.api?.projectGroups?.[NAMESPACE_MARKER] === true) {
      patchState.installed = true;
      return { applied: true, reason: 'already-installed' };
    }

    const fallbackNamespace = windowObject.api?.projectGroups;
    const bridge = createProjectGroupsBridge(windowObject, fallbackNamespace);
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
        ...(installed.applied ? ['projectGroups.list/create/update/delete/moveProject'] : []),
        ...(patchState.watcherInstalled ? ['project-groups-api-rewrap-watcher'] : [])
      ],
      reason: installed.reason
    };
  }

  OWP.bridgeWebProjectGroups = Object.freeze({
    readPairedEnvironment,
    runtimeErrorMessage,
    callRuntimeResult,
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
