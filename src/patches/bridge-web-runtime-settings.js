((OWP) => {
  'use strict';

  const SETTINGS_SET_MARKER = '__orcaWebPatchesRuntimeSettingsBridgeV1';
  const BRIDGED_SETTING_KEYS = Object.freeze([
    'defaultTuiAgent',
    'disabledTuiAgents',
    'agentDefaultArgs',
    'agentDefaultEnv',
    'defaultTaskSource',
    'visibleTaskProviders',
    'defaultTaskViewPreset',
    'agentStatusHooksEnabled',
    'defaultRepoSelection',
    'defaultLinearTeamSelection',
    'githubProjects'
  ]);

  const bridgeState = {
    installed: false,
    lastSyncStatus: 'idle',
    lastSyncedKeys: [],
    lastError: null
  };

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function pickBridgedSettings(value) {
    if (!isRecord(value)) return {};
    const picked = {};
    for (const key of BRIDGED_SETTING_KEYS) {
      if (Object.hasOwn(value, key) && value[key] !== undefined) {
        picked[key] = value[key];
      }
    }
    return picked;
  }

  function readExplicitStoredSettings(windowObject) {
    try {
      const raw = windowObject.localStorage?.getItem?.(OWP.constants.WEB_SETTINGS_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function activeEnvironmentSelector(windowObject) {
    try {
      return OWP.runtimeProfile.readCurrentEnvironment(windowObject.localStorage)?.environmentId ?? null;
    } catch {
      return null;
    }
  }

  function runtimeErrorMessage(response) {
    if (!response || response.ok !== false) return null;
    if (typeof response.error?.message === 'string' && response.error.message) {
      return response.error.message;
    }
    if (typeof response.error === 'string' && response.error) return response.error;
    return 'Runtime settings update failed';
  }

  async function updateRuntimeSettings(windowObject, updates) {
    const bridged = pickBridgedSettings(updates);
    const keys = Object.keys(bridged);
    if (keys.length === 0) return null;

    const selector = activeEnvironmentSelector(windowObject);
    if (!selector) return null;

    const runtimeEnvironments = windowObject.api?.runtimeEnvironments;
    if (typeof runtimeEnvironments?.call !== 'function') {
      throw new Error('Orca runtime environment API is unavailable');
    }

    bridgeState.lastSyncStatus = 'pending';
    bridgeState.lastSyncedKeys = keys;
    bridgeState.lastError = null;

    try {
      const response = await runtimeEnvironments.call({
        selector,
        method: 'settings.update',
        params: bridged
      });
      const message = runtimeErrorMessage(response);
      if (message) throw new Error(message);
      bridgeState.lastSyncStatus = 'success';
      return response;
    } catch (error) {
      bridgeState.lastSyncStatus = 'error';
      bridgeState.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  function installSettingsSetBridge(windowObject) {
    const settingsApi = windowObject.api?.settings;
    if (!settingsApi || typeof settingsApi.set !== 'function') {
      return { applied: false, reason: 'settings-api-unavailable' };
    }
    if (settingsApi.set?.[SETTINGS_SET_MARKER] === true) {
      bridgeState.installed = true;
      return { applied: true, reason: 'already-installed' };
    }

    const originalSet = settingsApi.set;
    const wrappedSet = async function wrappedWebSettingsSet(updates) {
      const result = await Reflect.apply(originalSet, settingsApi, [updates]);
      const bridged = pickBridgedSettings(updates);
      if (Object.keys(bridged).length > 0) {
        await updateRuntimeSettings(windowObject, bridged);
      }
      return result;
    };
    Object.defineProperty(wrappedSet, SETTINGS_SET_MARKER, { value: true });

    try {
      settingsApi.set = wrappedSet;
    } catch {
      // Fall through to defineProperty for stricter proxy/object surfaces.
    }
    if (settingsApi.set !== wrappedSet) {
      try {
        Object.defineProperty(settingsApi, 'set', {
          value: wrappedSet,
          configurable: true,
          writable: true
        });
      } catch {
        return { applied: false, reason: 'settings-set-not-writable' };
      }
    }

    bridgeState.installed = true;
    return { applied: true, reason: 'installed' };
  }

  async function syncExplicitStoredSettings(windowObject) {
    const explicit = pickBridgedSettings(readExplicitStoredSettings(windowObject));
    if (Object.keys(explicit).length === 0) return null;
    return updateRuntimeSettings(windowObject, explicit);
  }

  function applyBridgeWebRuntimeSettings(windowObject) {
    const installed = installSettingsSetBridge(windowObject);
    if (!installed.applied) {
      return { applied: false, fields: [], reason: installed.reason };
    }

    void syncExplicitStoredSettings(windowObject).catch(() => undefined);
    return {
      applied: true,
      fields: ['settings.set'],
      reason: installed.reason,
      bridgedSettingKeys: [...BRIDGED_SETTING_KEYS]
    };
  }

  OWP.bridgeWebRuntimeSettings = Object.freeze({
    BRIDGED_SETTING_KEYS,
    pickBridgedSettings,
    readExplicitStoredSettings,
    updateRuntimeSettings,
    syncExplicitStoredSettings,
    applyBridgeWebRuntimeSettings,
    getStatus: () => ({
      installed: bridgeState.installed,
      lastSyncStatus: bridgeState.lastSyncStatus,
      lastSyncedKeys: [...bridgeState.lastSyncedKeys],
      lastError: bridgeState.lastError
    })
  });
})(globalThis.__OWP__);
