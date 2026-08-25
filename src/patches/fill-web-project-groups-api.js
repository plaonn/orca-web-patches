((OWP) => {
  'use strict';

  const ADAPTER_MARKER = '__orcaWebPatchesProjectGroupsAdapterV1';
  const WATCH_INTERVAL_MS = 250;

  const patchState = {
    installed: false,
    watcherInstalled: false,
    adapterInstallCount: 0,
    observedCallCount: 0,
    lastMethod: null,
    lastStatus: 'idle',
    lastError: null
  };

  let watcherHandle = null;

  function activeEnvironmentSelector(windowObject) {
    try {
      return OWP.runtimeProfile.readCurrentEnvironment(windowObject.localStorage)?.environmentId ?? null;
    } catch {
      return null;
    }
  }

  function runtimeErrorMessage(response, method) {
    if (!response || response.ok !== false) return null;
    if (typeof response.error?.message === 'string' && response.error.message) {
      return response.error.message;
    }
    if (typeof response.error === 'string' && response.error) return response.error;
    return `${method} failed`;
  }

  async function callRuntime(windowObject, method, params) {
    const selector = activeEnvironmentSelector(windowObject);
    if (!selector) throw new Error('No paired Orca runtime environment is active');
    const runtimeEnvironments = windowObject.api?.runtimeEnvironments;
    if (typeof runtimeEnvironments?.call !== 'function') {
      throw new Error('Orca runtime environment API is unavailable');
    }

    patchState.observedCallCount += 1;
    patchState.lastMethod = method;
    patchState.lastStatus = 'pending';
    patchState.lastError = null;

    try {
      const request = { selector, method };
      if (params !== undefined) request.params = params;
      const response = await runtimeEnvironments.call(request);
      const message = runtimeErrorMessage(response, method);
      if (message) throw new Error(message);
      patchState.lastStatus = 'success';
      return response?.result;
    } catch (error) {
      patchState.lastStatus = 'error';
      patchState.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  function createAdapter(windowObject) {
    const adapter = {
      list: async () => {
        const result = await callRuntime(windowObject, 'projectGroup.list');
        return Array.isArray(result?.groups) ? result.groups : [];
      },
      create: async (args) => {
        const result = await callRuntime(windowObject, 'projectGroup.create', args ?? {});
        if (!result?.group || typeof result.group !== 'object') {
          throw new Error('projectGroup.create returned no group');
        }
        return result.group;
      },
      update: async ({ groupId, updates }) => {
        const result = await callRuntime(windowObject, 'projectGroup.update', { groupId, updates });
        return result?.group ?? null;
      },
      delete: async ({ groupId }) => {
        const result = await callRuntime(windowObject, 'projectGroup.delete', { groupId });
        return result?.deleted === true || result === true;
      },
      moveProject: async ({ projectId, groupId, order }) => {
        const params = { repo: projectId, groupId: groupId ?? null };
        if (order !== undefined) params.order = order;
        const result = await callRuntime(windowObject, 'projectGroup.moveProject', params);
        return result?.repo ?? null;
      },
      // Preserve the old Web fallback behavior for operations this patch does not backfill.
      scanNested: async () => undefined,
      cancelNestedScan: async () => undefined,
      onNestedScanProgress: () => () => {},
      importNested: async () => undefined
    };
    Object.defineProperty(adapter, ADAPTER_MARKER, { value: true });
    return adapter;
  }

  function installAdapter(windowObject) {
    const api = windowObject.api;
    if (!api || typeof api !== 'object') {
      return { applied: false, reason: 'preload-api-unavailable' };
    }
    if (api.projectGroups?.[ADAPTER_MARKER] === true) {
      patchState.installed = true;
      return { applied: true, reason: 'already-installed' };
    }

    const adapter = createAdapter(windowObject);
    try {
      api.projectGroups = adapter;
    } catch {
      // Fall through to defineProperty for stricter proxy/object surfaces.
    }
    if (api.projectGroups?.[ADAPTER_MARKER] !== true) {
      try {
        Object.defineProperty(api, 'projectGroups', {
          value: adapter,
          configurable: true,
          writable: true
        });
      } catch {
        return { applied: false, reason: 'project-groups-api-not-writable' };
      }
    }

    patchState.installed = true;
    patchState.adapterInstallCount += 1;
    return {
      applied: true,
      fields: ['api.projectGroups'],
      reason: 'adapter-installed'
    };
  }

  function installWatcher(windowObject) {
    if (watcherHandle !== null) {
      patchState.watcherInstalled = true;
      return { applied: true, reason: 'watcher-already-installed' };
    }
    if (typeof windowObject.setInterval !== 'function') {
      return { applied: false, reason: 'setinterval-unavailable' };
    }
    watcherHandle = windowObject.setInterval(() => {
      try {
        installAdapter(windowObject);
      } catch (error) {
        patchState.lastError = error instanceof Error ? error.message : String(error);
      }
    }, WATCH_INTERVAL_MS);
    patchState.watcherInstalled = true;
    return { applied: true, reason: 'watcher-installed' };
  }

  function applyFillWebProjectGroupsApi(windowObject) {
    const adapter = installAdapter(windowObject);
    const watcher = installWatcher(windowObject);
    const applied = adapter.applied;
    return {
      applied,
      fields: [
        ...(adapter.applied ? ['api.projectGroups'] : []),
        ...(watcher.applied ? ['project-groups-api-rewrap-watcher'] : [])
      ],
      reason: applied ? adapter.reason : `${adapter.reason};${watcher.reason}`
    };
  }

  OWP.fillWebProjectGroupsApi = Object.freeze({
    activeEnvironmentSelector,
    callRuntime,
    createAdapter,
    installAdapter,
    installWatcher,
    applyFillWebProjectGroupsApi,
    getStatus: () => ({ ...patchState })
  });
})(globalThis.__OWP__);
