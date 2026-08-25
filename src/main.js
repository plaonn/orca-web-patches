((OWP) => {
  'use strict';

  const state = {
    scriptVersion: OWP.constants.SCRIPT_VERSION,
    environmentFound: false,
    bootstrapProfile: null,
    bootstrapPatchApplied: false,
    bootstrapPatchFields: [],
    discoveryStatus: 'idle',
    lastDiscovery: null,
    reloadRequested: false
  };

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
      appVersion: discovered.appVersion
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

  function wantsLinuxPatch(profile) {
    return OWP.patchRegistry.shouldApplyPatch(
      OWP.patchRegistry.getPatch('force-linux-platform'),
      profile
    );
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
      getStatus: () => JSON.parse(JSON.stringify(state)),
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
    const desiredLinuxPatch = wantsLinuxPatch(profile);
    if (desiredLinuxPatch !== state.bootstrapPatchApplied) {
      const reason = [
        environment.environmentId,
        profile.runtimeId,
        profile.platform,
        profile.appVersion ?? 'unknown',
        desiredLinuxPatch ? 'linux-on' : 'linux-off'
      ].join('|');
      requestBoundedReload(windowObject, reason);
      return state.lastDiscovery;
    }

    clearReloadGuard(windowObject);
    return state.lastDiscovery;
  }

  function start(windowObject = globalThis.window) {
    if (!windowObject?.localStorage) return state;
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
    if (profile && wantsLinuxPatch(profile)) {
      const result = OWP.forceLinuxPlatform.applyForceLinuxPlatform(windowObject.navigator);
      state.bootstrapPatchApplied = result.applied;
      state.bootstrapPatchFields = result.fields;
      debug(windowObject, 'bootstrap Linux platform patch:', result);
    }

    installDebugApi(windowObject);
    void runRevalidation(windowObject);
    return state;
  }

  OWP.main = Object.freeze({ start, revalidate: runRevalidation, wantsLinuxPatch, requestBoundedReload });
  start();
})(globalThis.__OWP__);
