((OWP) => {
  'use strict';

  OWP.constants = Object.freeze({
    SCRIPT_VERSION: '0.2.3',
    ORCA_ENVIRONMENT_STORAGE_KEY: 'orca.web.runtimeEnvironment.v1',
    WEB_SETTINGS_STORAGE_KEY: 'orca.web.settings.v1',
    PROFILE_STORAGE_KEY: 'orca.web.patches.runtimeProfile.v1',
    RELOAD_GUARD_KEY: 'orca.web.patches.reloadGuard.v1',
    CACHE_TTL_MS: 6 * 60 * 60 * 1000,
    API_WAIT_TIMEOUT_MS: 15_000,
    API_POLL_INTERVAL_MS: 100,
    RUNTIME_CALL_TIMEOUT_MS: 15_000,
    DEBUG_QUERY_PARAM: 'orcaWebPatchesDebug'
  });
})(globalThis.__OWP__);
