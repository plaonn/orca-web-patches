((OWP) => {
  'use strict';

  const NODE_PLATFORMS = new Set([
    'aix', 'android', 'darwin', 'freebsd', 'haiku', 'linux',
    'openbsd', 'sunos', 'win32', 'cygwin', 'netbsd'
  ]);

  function parseJson(raw) {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function normalizeEnvironment(value) {
    if (!value || typeof value !== 'object') return null;
    if (typeof value.id !== 'string' || !value.id) return null;
    if (!Array.isArray(value.endpoints) || value.endpoints.length === 0) return null;
    const preferred = value.endpoints.find((entry) => entry?.id === value.preferredEndpointId)
      ?? value.endpoints[0];
    if (!preferred || typeof preferred !== 'object') return null;
    if (typeof preferred.endpoint !== 'string' || !preferred.endpoint) return null;
    if (typeof preferred.publicKeyB64 !== 'string' || !preferred.publicKeyB64) return null;
    return {
      environmentId: value.id,
      endpoint: preferred.endpoint,
      publicKeyB64: preferred.publicKeyB64
    };
  }

  function readCurrentEnvironment(storage) {
    return normalizeEnvironment(parseJson(storage?.getItem?.(OWP.constants.ORCA_ENVIRONMENT_STORAGE_KEY)));
  }

  function profileMatchesEnvironment(profile, environment) {
    return Boolean(
      profile && environment
      && profile.environmentId === environment.environmentId
      && profile.endpoint === environment.endpoint
      && profile.publicKeyB64 === environment.publicKeyB64
    );
  }

  function isValidPlatform(value) {
    return typeof value === 'string' && NODE_PLATFORMS.has(value);
  }

  function normalizeProfile(value) {
    if (!value || typeof value !== 'object' || value.schemaVersion !== 1) return null;
    if (typeof value.environmentId !== 'string' || !value.environmentId) return null;
    if (typeof value.endpoint !== 'string' || !value.endpoint) return null;
    if (typeof value.publicKeyB64 !== 'string' || !value.publicKeyB64) return null;
    if (typeof value.runtimeId !== 'string' || !value.runtimeId) return null;
    if (!isValidPlatform(value.platform)) return null;
    if (value.appVersion !== null && typeof value.appVersion !== 'string') return null;
    if (!Number.isFinite(value.verifiedAt) || value.verifiedAt <= 0) return null;
    return {
      schemaVersion: 1,
      environmentId: value.environmentId,
      endpoint: value.endpoint,
      publicKeyB64: value.publicKeyB64,
      runtimeId: value.runtimeId,
      platform: value.platform,
      appVersion: value.appVersion,
      verifiedAt: value.verifiedAt
    };
  }

  function readProfile(storage) {
    return normalizeProfile(parseJson(storage?.getItem?.(OWP.constants.PROFILE_STORAGE_KEY)));
  }

  function readFreshMatchingProfile(storage, environment, now = Date.now()) {
    const profile = readProfile(storage);
    if (!profileMatchesEnvironment(profile, environment)) return null;
    if (now - profile.verifiedAt > OWP.constants.CACHE_TTL_MS) return null;
    if (profile.verifiedAt > now + 60_000) return null;
    return profile;
  }

  function writeProfile(storage, environment, discovered, now = Date.now()) {
    if (!environment) throw new Error('Cannot cache runtime profile without an Orca environment identity.');
    if (!discovered || typeof discovered.runtimeId !== 'string' || !discovered.runtimeId) {
      throw new Error('Cannot cache runtime profile without a runtimeId.');
    }
    if (!isValidPlatform(discovered.platform)) {
      throw new Error('Cannot cache runtime profile with an invalid platform.');
    }
    const profile = {
      schemaVersion: 1,
      ...environment,
      runtimeId: discovered.runtimeId,
      platform: discovered.platform,
      appVersion: typeof discovered.appVersion === 'string' && discovered.appVersion.trim()
        ? discovered.appVersion.trim()
        : null,
      verifiedAt: now
    };
    storage.setItem(OWP.constants.PROFILE_STORAGE_KEY, JSON.stringify(profile));
    return profile;
  }

  function clearProfile(storage) {
    storage?.removeItem?.(OWP.constants.PROFILE_STORAGE_KEY);
  }

  OWP.runtimeProfile = Object.freeze({
    readCurrentEnvironment,
    profileMatchesEnvironment,
    isValidPlatform,
    normalizeProfile,
    readProfile,
    readFreshMatchingProfile,
    writeProfile,
    clearProfile
  });
})(globalThis.__OWP__);
