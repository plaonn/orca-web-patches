((OWP) => {
  'use strict';

  const GET_ITEM_MARKER = '__orcaWebPatchesPairedRuntimeAuthorityV1';

  const patchState = {
    installed: false,
    projectedReadCount: 0,
    lastProjectedEnvironmentId: null,
    lastError: null
  };

  function parseRecord(raw) {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function readEnvironmentId(rawEnvironment) {
    const parsed = parseRecord(rawEnvironment);
    const id = typeof parsed?.id === 'string' ? parsed.id.trim() : '';
    return id || null;
  }

  function projectSettingsRead(rawSettings, environmentId) {
    if (!environmentId) return rawSettings;
    if (rawSettings === null) {
      return JSON.stringify({ activeRuntimeEnvironmentId: environmentId });
    }
    const parsed = parseRecord(rawSettings);
    if (!parsed) return rawSettings;
    const explicit = typeof parsed.activeRuntimeEnvironmentId === 'string'
      ? parsed.activeRuntimeEnvironmentId.trim()
      : '';
    if (explicit) return rawSettings;
    return JSON.stringify({ ...parsed, activeRuntimeEnvironmentId: environmentId });
  }

  function installPairedRuntimeAuthorityProjection(windowObject) {
    const storage = windowObject?.localStorage;
    if (!storage || typeof storage.getItem !== 'function') {
      patchState.installed = false;
      return { applied: false, reason: 'local-storage-unavailable' };
    }

    const prototype = Object.getPrototypeOf(storage);
    const target = prototype && typeof prototype.getItem === 'function' ? prototype : storage;
    const currentGetItem = target.getItem;
    if (currentGetItem?.[GET_ITEM_MARKER] === true) {
      patchState.installed = true;
      return { applied: true, reason: 'already-installed' };
    }

    const wrappedGetItem = function projectedWebSettingsGetItem(key) {
      const raw = Reflect.apply(currentGetItem, this, [key]);
      if (this !== storage || String(key) !== OWP.constants.WEB_SETTINGS_STORAGE_KEY) {
        return raw;
      }

      try {
        const rawEnvironment = Reflect.apply(currentGetItem, this, [
          OWP.constants.ORCA_ENVIRONMENT_STORAGE_KEY
        ]);
        const environmentId = readEnvironmentId(rawEnvironment);
        const projected = projectSettingsRead(raw, environmentId);
        if (projected !== raw) {
          patchState.projectedReadCount += 1;
          patchState.lastProjectedEnvironmentId = environmentId;
        }
        return projected;
      } catch (error) {
        patchState.lastError = error instanceof Error ? error.message : String(error);
        return raw;
      }
    };
    Object.defineProperty(wrappedGetItem, GET_ITEM_MARKER, { value: true });

    try {
      target.getItem = wrappedGetItem;
    } catch {
      // Fall through to defineProperty for browser Storage prototypes.
    }
    if (target.getItem !== wrappedGetItem) {
      try {
        Object.defineProperty(target, 'getItem', {
          value: wrappedGetItem,
          configurable: true,
          writable: true
        });
      } catch {
        patchState.installed = false;
        return { applied: false, reason: 'storage-getitem-not-writable' };
      }
    }

    patchState.installed = true;
    return { applied: true, reason: 'installed' };
  }

  function applyProjectPairedRuntimeAuthority(windowObject) {
    const result = installPairedRuntimeAuthorityProjection(windowObject);
    return {
      applied: result.applied,
      fields: result.applied ? ['localStorage.getItem(orca.web.settings.v1)'] : [],
      reason: result.reason
    };
  }

  OWP.projectPairedRuntimeAuthority = Object.freeze({
    parseRecord,
    readEnvironmentId,
    projectSettingsRead,
    installPairedRuntimeAuthorityProjection,
    applyProjectPairedRuntimeAuthority,
    getStatus: () => ({ ...patchState })
  });
})(globalThis.__OWP__);
