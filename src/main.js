((OWP) => {
  'use strict';

  const state = {
    scriptVersion: OWP.constants.SCRIPT_VERSION,
    environmentFound: false,
    bootstrapProfile: null,
    bootstrapSelectedPatchIds: [],
    bootstrapAppliedPatchIds: [],
    bootstrapPatchApplied: false,
    bootstrapPatchFields: [],
    bootstrapPatchResults: [],
    patchDecisions: [],
    runtimeSelectedPatchIds: [],
    runtimeAppliedPatchIds: [],
    runtimePatchResults: [],
    runtimePatchDecisions: [],
    discoveryStatus: 'idle',
    lastDiscovery: null,
    reloadRequested: false
  };

  let selectionContext = null;

  function summarizeProfile(profile) {
    return profile ? {
      platform: profile.platform,
      appVersion: profile.appVersion,
      verifiedAt: profile.verifiedAt
    } : null;
  }

  function summarizeDiscovery(discovered) {
    if (!discovered?.ok) return discovered;
    return {
      ok: true,
      platform: discovered.platform,
      appVersion: discovered.appVersion,
      transport: discovered.transport ?? null
    };
  }

  function isDebugEnabled(windowObject) {
    try {
      return new URLSearchParams(windowObject.location.search).get(OWP.constants.DEBUG_QUERY_PARAM) === '1';
    } catch {
      return false;
    }
  }

  function debug(windowObject, ...args) {
    if (isDebugEnabled(windowObject)) windowObject.console?.debug?.('[Orca Web Patches]', ...args);
  }

  function createSelectionContext(windowObject) {
    return Object.freeze({
      browserPlatform: typeof windowObject?.navigator?.platform === 'string'
        ? windowObject.navigator.platform
        : null
    });
  }

  function selectBootstrapPatches(profile) {
    return OWP.patchRegistry.selectPatches(profile, selectionContext ?? {}, { phase: 'bootstrap' });
  }

  function selectRuntimePatches(profile) {
    return OWP.patchRegistry.selectPatches(profile, selectionContext ?? {}, { phase: 'runtime' });
  }

  function patchIds(selection) {
    return selection.selected.map((patch) => patch.id);
  }

  function samePatchIds(left, right) {
    if (left.length !== right.length) return false;
    return left.every((id, index) => id === right[index]);
  }

  function applyPatch(windowObject, patch, profile) {
    if (patch.id === 'align-browser-platform-to-runtime') {
      return OWP.alignBrowserPlatformToRuntime.applyAlignBrowserPlatformToRuntime(
        windowObject.navigator,
        profile?.platform
      );
    }
    if (patch.id === 'bridge-web-runtime-settings') {
      return OWP.bridgeWebRuntimeSettings.applyBridgeWebRuntimeSettings(windowObject);
    }
    if (patch.id === 'qualify-runtime-worktree-removal-host') {
      return OWP.qualifyRuntimeWorktreeRemovalHost.applyQualifyRuntimeWorktreeRemovalHost(windowObject);
    }
    if (patch.id === 'fill-web-project-groups-api') {
      return OWP.fillWebProjectGroupsApi.applyFillWebProjectGroupsApi(windowObject);
    }
    return { applied: false, fields: [], reason: 'patch-implementation-unavailable' };
  }

  function applyBootstrapPatches(windowObject, selection, profile) {
    const appliedPatchIds = [];
    const fields = [];
    const results = [];

    for (const patch of selection.selected) {
      const result = applyPatch(windowObject, patch, profile);
      if (result?.applied) appliedPatchIds.push(patch.id);
      for (const field of result?.fields ?? []) fields.push(field);
      results.push({
        patchId: patch.id,
        applied: result?.applied === true,
        fields: [...(result?.fields ?? [])],
        reason: result?.reason ?? null
      });
    }

    state.bootstrapSelectedPatchIds = patchIds(selection);
    state.bootstrapAppliedPatchIds = appliedPatchIds;
    state.bootstrapPatchApplied = appliedPatchIds.length > 0;
    state.bootstrapPatchFields = fields;
    state.bootstrapPatchResults = results;
    state.patchDecisions = selection.decisions;
  }

  function applyRuntimePatches(windowObject, selection, profile) {
    const appliedPatchIds = [];
    const results = [];

    for (const patch of selection.selected) {
      const result = applyPatch(windowObject, patch, profile);
      if (result?.applied) appliedPatchIds.push(patch.id);
      results.push({
        patchId: patch.id,
        applied: result?.applied === true,
        fields: [...(result?.fields ?? [])],
        reason: result?.reason ?? null
      });
    }

    state.runtimeSelectedPatchIds = patchIds(selection);
    state.runtimeAppliedPatchIds = appliedPatchIds;
    state.runtimePatchResults = results;
    state.runtimePatchDecisions = selection.decisions;
  }

  function requestBoundedReload(windowObject, reason) {
    const storage = windowObject.sessionStorage;
    const current = storage?.getItem?.(OWP.constants.RELOAD_GUARD_KEY);
    if (current === reason) return false;
    storage?.setItem?.(OWP.constants.RELOAD_GUARD_KEY, reason);
    state.reloadRequested = true;
    windowObject.location.reload();
    return true;
  }

  function clearReloadGuard(windowObject) {
    windowObject.sessionStorage?.removeItem?.(OWP.constants.RELOAD_GUARD_KEY);
  }

  function installDebugApi(windowObject) {
    const api = Object.freeze({
      getStatus: () => {
        const snapshot = JSON.parse(JSON.stringify(state));
        if (OWP.bridgeWebRuntimeSettings?.getStatus) {
          snapshot.runtimeSettingsBridge = OWP.bridgeWebRuntimeSettings.getStatus();
        }
        if (OWP.qualifyRuntimeWorktreeRemovalHost?.getStatus) {
          snapshot.worktreeRemovalHostQualification = OWP.qualifyRuntimeWorktreeRemovalHost.getStatus();
        }
        if (OWP.fillWebProjectGroupsApi?.getStatus) {
          snapshot.webProjectGroupsAdapter = OWP.fillWebProjectGroupsApi.getStatus();
        }
        return snapshot;
      },
      recheck: () => runRevalidation(windowObject),
      clearCache: () => {
        OWP.runtimeProfile.clearProfile(windowObject.localStorage);
        clearReloadGuard(windowObject);
        return true;
      }
    });
    try {
      Object.defineProperty(windowObject, '__orcaWebPatches', {
        value: api,
        configurable: true
      });
    } catch {
      // Diagnostics are optional; patch behavior must not depend on this surface.
    }
  }

  async function runRevalidation(windowObject) {
    const environment = OWP.runtimeProfile.readCurrentEnvironment(windowObject.localStorage);
    if (!environment) {
      state.discoveryStatus = 'error';
      state.lastDiscovery = { ok: false, reason: 'orca-environment-not-found', stage: 'environment' };
      return state.lastDiscovery;
    }

    state.discoveryStatus = 'pending';
    state.lastDiscovery = { ok: false, reason: 'runtime-discovery-pending', stage: 'discovery' };

    let discovered;
    try {
      discovered = await OWP.runtimeDiscovery.discoverRuntime(windowObject, environment);
    } catch {
      state.discoveryStatus = 'error';
      state.lastDiscovery = { ok: false, reason: 'runtime-discovery-threw', stage: 'discovery' };
      return state.lastDiscovery;
    }

    state.lastDiscovery = summarizeDiscovery(discovered);
    if (!discovered.ok) {
      state.discoveryStatus = 'error';
      debug(windowObject, 'runtime revalidation skipped:', discovered.reason);
      return state.lastDiscovery;
    }

    let profile;
    try {
      profile = OWP.runtimeProfile.writeProfile(
        windowObject.localStorage,
        environment,
        discovered
      );
    } catch {
      state.discoveryStatus = 'error';
      state.lastDiscovery = { ok: false, reason: 'runtime-profile-cache-write-failed', stage: 'cache' };
      return state.lastDiscovery;
    }

    state.discoveryStatus = 'success';
    const desiredSelection = selectBootstrapPatches(profile);
    const desiredPatchIds = patchIds(desiredSelection);
    state.patchDecisions = desiredSelection.decisions;

    if (!samePatchIds(desiredPatchIds, state.bootstrapSelectedPatchIds)) {
      const reason = [
        environment.environmentId,
        profile.runtimeId,
        profile.platform,
        profile.appVersion ?? 'unknown',
        desiredPatchIds.length > 0 ? desiredPatchIds.join(',') : 'no-patches'
      ].join('|');
      requestBoundedReload(windowObject, reason);
      return state.lastDiscovery;
    }

    clearReloadGuard(windowObject);
    const runtimeSelection = selectRuntimePatches(profile);
    applyRuntimePatches(windowObject, runtimeSelection, profile);
    if (runtimeSelection.selected.length > 0) {
      debug(windowObject, 'runtime patch selection:', state.runtimePatchDecisions);
    }
    return state.lastDiscovery;
  }

  function start(windowObject = globalThis.window) {
    if (!windowObject?.localStorage) return state;
    selectionContext = createSelectionContext(windowObject);

    const environment = OWP.runtimeProfile.readCurrentEnvironment(windowObject.localStorage);
    if (!environment) {
      installDebugApi(windowObject);
      return state;
    }
    state.environmentFound = true;

    const profile = OWP.runtimeProfile.readFreshMatchingProfile(
      windowObject.localStorage,
      environment
    );
    state.bootstrapProfile = summarizeProfile(profile);

    const bootstrapSelection = selectBootstrapPatches(profile);
    applyBootstrapPatches(windowObject, bootstrapSelection, profile);
    if (bootstrapSelection.selected.length > 0) {
      debug(windowObject, 'bootstrap patch selection:', state.patchDecisions);
    }

    installDebugApi(windowObject);
    void runRevalidation(windowObject);
    return state;
  }

  OWP.main = Object.freeze({
    start,
    revalidate: runRevalidation,
    createSelectionContext,
    selectBootstrapPatches,
    selectRuntimePatches,
    requestBoundedReload
  });
  start();
})(globalThis.__OWP__);
