((OWP) => {
  'use strict';

  const SETTINGS_SET_MARKER = '__orcaWebPatchesRuntimeSettingsBridgeV1';
  const STORAGE_SET_MARKER = '__orcaWebPatchesRuntimeSettingsStorageBridgeV1';
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
    settingsSetWrapped: false,
    storageObserverInstalled: false,
    observedWriteCount: 0,
    lastSyncStatus: 'idle',
    lastSyncSource: null,
    lastSyncedKeys: [],
    lastError: null
  };

  let lastObservedStoredSettings = null;
  let syncQueue = Promise.resolve();

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

  function parseStoredSettings(raw) {
    try {
      const parsed = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function readExplicitStoredSettings(windowObject) {
    try {
      const raw = windowObject.localStorage?.getItem?.(OWP.constants.WEB_SETTINGS_STORAGE_KEY);
      if (!raw) return {};
      return parseStoredSettings(raw);
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

  function sameValue(left, right) {
    if (Object.is(left, right)) return true;
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  function changedBridgedSettings(previous, next) {
    const changed = {};
    for (const key of BRIDGED_SETTING_KEYS) {
      if (!Object.hasOwn(next, key)) continue;
      if (!Object.hasOwn(previous ?? {}, key) || !sameValue(previous[key], next[key])) {
        changed[key] = next[key];
      }
    }
    return changed;
  }

  async function updateRuntimeSettings(windowObject, updates, source = 'direct') {
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
    bridgeState.lastSyncSource = source;
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

  function enqueueRuntimeSettingsUpdate(windowObject, updates, source) {
    if (Object.keys(pickBridgedSettings(updates)).length === 0) return syncQueue;
    syncQueue = syncQueue
      .catch(() => undefined)
      .then(() => updateRuntimeSettings(windowObject, updates, source));
    return syncQueue;
  }

  function observeStoredSettingsWrite(windowObject, rawValue) {
    bridgeState.observedWriteCount += 1;
    const next = pickBridgedSettings(parseStoredSettings(String(rawValue)));
    const changed = changedBridgedSettings(lastObservedStoredSettings ?? {}, next);
    lastObservedStoredSettings = next;
    if (Object.keys(changed).length > 0) {
      void enqueueRuntimeSettingsUpdate(windowObject, changed, 'storage-write').catch(() => undefined);
    }
  }

  function installStorageWriteBridge(windowObject) {
    const storage = windowObject.localStorage;
    if (!storage || typeof storage.setItem !== 'function') {
      return { applied: false, reason: 'local-storage-unavailable' };
    }

    const prototype = Object.getPrototypeOf(storage);
    const target = prototype && typeof prototype.setItem === 'function' ? prototype : storage;
    const currentSetItem = target.setItem;
    if (currentSetItem?.[STORAGE_SET_MARKER] === true) {
      bridgeState.storageObserverInstalled = true;
      return { applied: true, reason: 'storage-observer-already-installed' };
    }

    const wrappedSetItem = function wrappedStorageSetItem(key, value) {
      const result = Reflect.apply(currentSetItem, this, [key, value]);
      if (this === storage && String(key) === OWP.constants.WEB_SETTINGS_STORAGE_KEY) {
        observeStoredSettingsWrite(windowObject, value);
      }
      return result;
    };
    Object.defineProperty(wrappedSetItem, STORAGE_SET_MARKER, { value: true });

    try {
      target.setItem = wrappedSetItem;
    } catch {
      // Fall through to defineProperty for browser Storage prototypes.
    }
    if (target.setItem !== wrappedSetItem) {
      try {
        Object.defineProperty(target, 'setItem', {
          value: wrappedSetItem,
          configurable: true,
          writable: true
        });
      } catch {
        return { applied: false, reason: 'storage-setitem-not-writable' };
      }
    }

    bridgeState.storageObserverInstalled = true;
    return { applied: true, reason: 'storage-observer-installed' };
  }

  function installSettingsSetBridge(windowObject) {
    const settingsApi = windowObject.api?.settings;
    if (!settingsApi || typeof settingsApi.set !== 'function') {
      return { applied: false, reason: 'settings-api-unavailable' };
    }
    if (settingsApi.set?.[SETTINGS_SET_MARKER] === true) {
      bridgeState.settingsSetWrapped = true;
      return { applied: true, reason: 'settings-set-already-wrapped' };
    }

    const originalSet = settingsApi.set;
    const wrappedSet = async function wrappedWebSettingsSet(updates) {
      const writesBefore = bridgeState.observedWriteCount;
      const result = await Reflect.apply(originalSet, settingsApi, [updates]);
      if (bridgeState.observedWriteCount === writesBefore) {
        const bridged = pickBridgedSettings(updates);
        if (Object.keys(bridged).length > 0) {
          await enqueueRuntimeSettingsUpdate(windowObject, bridged, 'settings-set-fallback');
        }
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

    bridgeState.settingsSetWrapped = true;
    return { applied: true, reason: 'settings-set-wrapped' };
  }

  async function syncExplicitStoredSettings(windowObject) {
    const explicit = pickBridgedSettings(readExplicitStoredSettings(windowObject));
    lastObservedStoredSettings = explicit;
    if (Object.keys(explicit).length === 0) return null;
    return enqueueRuntimeSettingsUpdate(windowObject, explicit, 'initial-storage-sync');
  }

  function applyBridgeWebRuntimeSettings(windowObject) {
    const storageBridge = installStorageWriteBridge(windowObject);
    const settingsBridge = installSettingsSetBridge(windowObject);
    if (!storageBridge.applied && !settingsBridge.applied) {
      return {
        applied: false,
        fields: [],
        reason: `${storageBridge.reason};${settingsBridge.reason}`
      };
    }

    void syncExplicitStoredSettings(windowObject).catch(() => undefined);
    bridgeState.installed = true;
    return {
      applied: true,
      fields: [
        ...(storageBridge.applied ? ['localStorage.setItem'] : []),
        ...(settingsBridge.applied ? ['settings.set'] : [])
      ],
      reason: storageBridge.applied ? storageBridge.reason : settingsBridge.reason,
      bridgedSettingKeys: [...BRIDGED_SETTING_KEYS]
    };
  }

  OWP.bridgeWebRuntimeSettings = Object.freeze({
    BRIDGED_SETTING_KEYS,
    pickBridgedSettings,
    changedBridgedSettings,
    readExplicitStoredSettings,
    updateRuntimeSettings,
    enqueueRuntimeSettingsUpdate,
    syncExplicitStoredSettings,
    applyBridgeWebRuntimeSettings,
    getStatus: () => ({
      installed: bridgeState.installed,
      settingsSetWrapped: bridgeState.settingsSetWrapped,
      storageObserverInstalled: bridgeState.storageObserverInstalled,
      observedWriteCount: bridgeState.observedWriteCount,
      lastSyncStatus: bridgeState.lastSyncStatus,
      lastSyncSource: bridgeState.lastSyncSource,
      lastSyncedKeys: [...bridgeState.lastSyncedKeys],
      lastError: bridgeState.lastError
    })
  });
})(globalThis.__OWP__);
