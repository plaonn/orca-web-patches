// ==UserScript==
// @name         Orca Web Patches
// @namespace    https://github.com/plaonn/orca-web-patches
// @version      0.1.0
// @description  Version-aware compatibility patches for Orca Web.
// @homepageURL  https://github.com/plaonn/orca-web-patches
// @supportURL   https://github.com/plaonn/orca-web-patches/issues
// @updateURL    https://raw.githubusercontent.com/plaonn/orca-web-patches/main/dist/orca-web-patches.user.js
// @downloadURL  https://raw.githubusercontent.com/plaonn/orca-web-patches/main/dist/orca-web-patches.user.js
// @match        http://localhost/*
// @match        https://localhost/*
// @match        http://127.0.0.1/*
// @match        https://127.0.0.1/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  const OWP = {};

  // ---- src/constants.js ----
  ((OWP) => {
    'use strict';
  
    OWP.constants = Object.freeze({
      SCRIPT_VERSION: '0.1.0',
      ORCA_ENVIRONMENT_STORAGE_KEY: 'orca.web.runtimeEnvironment.v1',
      PROFILE_STORAGE_KEY: 'orca.web.patches.runtimeProfile.v1',
      RELOAD_GUARD_KEY: 'orca.web.patches.reloadGuard.v1',
      CACHE_TTL_MS: 6 * 60 * 60 * 1000,
      API_WAIT_TIMEOUT_MS: 15_000,
      API_POLL_INTERVAL_MS: 100,
      RUNTIME_CALL_TIMEOUT_MS: 15_000,
      DEBUG_QUERY_PARAM: 'orcaWebPatchesDebug'
    });
  })(OWP);
  

  // ---- src/version.js ----
  ((OWP) => {
    'use strict';
  
    const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
  
    function parseSemver(value) {
      if (typeof value !== 'string') return null;
      const match = SEMVER_RE.exec(value.trim());
      if (!match) return null;
      return {
        raw: value.trim(),
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ? match[4].split('.') : []
      };
    }
  
    function compareIdentifier(left, right) {
      const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
      const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
      if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
      if (leftNumber !== null) return -1;
      if (rightNumber !== null) return 1;
      return left === right ? 0 : left < right ? -1 : 1;
    }
  
    function compareParsed(left, right) {
      for (const key of ['major', 'minor', 'patch']) {
        if (left[key] !== right[key]) return Math.sign(left[key] - right[key]);
      }
      if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
      if (left.prerelease.length === 0) return 1;
      if (right.prerelease.length === 0) return -1;
      const length = Math.max(left.prerelease.length, right.prerelease.length);
      for (let index = 0; index < length; index += 1) {
        const l = left.prerelease[index];
        const r = right.prerelease[index];
        if (l === undefined) return -1;
        if (r === undefined) return 1;
        const compared = compareIdentifier(l, r);
        if (compared !== 0) return compared;
      }
      return 0;
    }
  
    function compareSemver(leftValue, rightValue) {
      const left = parseSemver(leftValue);
      const right = parseSemver(rightValue);
      if (!left || !right) return null;
      return compareParsed(left, right);
    }
  
    OWP.versioning = Object.freeze({ parseSemver, compareSemver });
  })(OWP);
  

  // ---- src/runtime-profile.js ----
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
  })(OWP);
  

  // ---- src/patch-registry.js ----
  ((OWP) => {
    'use strict';
  
    const PATCHES = Object.freeze([
      Object.freeze({
        id: 'force-linux-platform',
        phase: 'bootstrap',
        platforms: Object.freeze(['linux']),
        unknownVersionBehavior: 'apply',
        applyUntilFixed: true,
        evidence: Object.freeze({
          confirmedAffected: Object.freeze(['1.4.188']),
          upstreamSourceObservedAt: 'cc4801320a75f2fd87f67454e13dae7a63117097',
          fixedIn: null
        }),
        rationale: 'Orca Web derives its preload platform from the browser instead of the connected runtime.'
      })
    ]);
  
    function getPatch(id) {
      return PATCHES.find((patch) => patch.id === id) ?? null;
    }
  
    function shouldApplyPatch(patch, profile) {
      if (!patch || !profile) return false;
      if (!patch.platforms.includes(profile.platform)) return false;
  
      const fixedIn = patch.evidence?.fixedIn ?? null;
      if (fixedIn) {
        const compared = OWP.versioning.compareSemver(profile.appVersion, fixedIn);
        if (compared !== null && compared >= 0) return false;
        if (compared === null) return patch.unknownVersionBehavior === 'apply';
      }
  
      if (profile.appVersion === null || OWP.versioning.parseSemver(profile.appVersion) === null) {
        return patch.unknownVersionBehavior === 'apply';
      }
  
      return patch.applyUntilFixed === true
        || patch.evidence.confirmedAffected.includes(profile.appVersion);
    }
  
    OWP.patchRegistry = Object.freeze({ PATCHES, getPatch, shouldApplyPatch });
  })(OWP);
  

  // ---- src/patches/force-linux-platform.js ----
  ((OWP) => {
    'use strict';
  
    function defineNavigatorValue(navigatorObject, name, value) {
      const descriptor = { get: () => value, configurable: true };
      const prototype = Object.getPrototypeOf(navigatorObject);
      try {
        Object.defineProperty(prototype, name, descriptor);
        if (navigatorObject[name] === value) return true;
      } catch {
        // Fall through to an own-property override for unusual browser/test shapes.
      }
      try {
        Object.defineProperty(navigatorObject, name, descriptor);
        return navigatorObject[name] === value;
      } catch {
        return false;
      }
    }
  
    function linuxUserAgent(userAgent) {
      if (typeof userAgent !== 'string') return userAgent;
      if (/\(Windows NT [^)]+\)/.test(userAgent)) {
        return userAgent.replace(/\(Windows NT [^)]+\)/, '(X11; Linux x86_64)');
      }
      return userAgent;
    }
  
    function linuxAppVersion(appVersion) {
      if (typeof appVersion !== 'string') return appVersion;
      return appVersion.replace(/Windows NT [^;)]+(?:; Win64; x64)?/g, 'X11; Linux x86_64');
    }
  
    function createLinuxUserAgentData(original) {
      if (!original || typeof original !== 'object') return original;
      return new Proxy(original, {
        get(target, property) {
          if (property === 'platform') return 'Linux';
          if (property === 'getHighEntropyValues') {
            return async (hints = []) => {
              const originalMethod = Reflect.get(target, property, target);
              const result = typeof originalMethod === 'function'
                ? await originalMethod.call(target, hints)
                : {};
              const next = { ...result };
              if (hints.includes('platform')) next.platform = 'Linux';
              if (hints.includes('platformVersion')) next.platformVersion = '0.0.0';
              return next;
            };
          }
          if (property === 'toJSON') {
            return () => {
              const method = Reflect.get(target, property, target);
              const result = typeof method === 'function' ? method.call(target) : {};
              return { ...result, platform: 'Linux' };
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    }
  
    function applyForceLinuxPlatform(navigatorObject = globalThis.navigator) {
      if (!navigatorObject) return { applied: false, fields: [] };
      const fields = [];
      const userAgent = linuxUserAgent(navigatorObject.userAgent);
      const appVersion = linuxAppVersion(navigatorObject.appVersion);
  
      if (defineNavigatorValue(navigatorObject, 'platform', 'Linux x86_64')) fields.push('platform');
      if (typeof userAgent === 'string' && defineNavigatorValue(navigatorObject, 'userAgent', userAgent)) {
        fields.push('userAgent');
      }
      if (typeof appVersion === 'string' && defineNavigatorValue(navigatorObject, 'appVersion', appVersion)) {
        fields.push('appVersion');
      }
      if (navigatorObject.userAgentData) {
        const proxy = createLinuxUserAgentData(navigatorObject.userAgentData);
        if (defineNavigatorValue(navigatorObject, 'userAgentData', proxy)) fields.push('userAgentData');
      }
      return { applied: fields.length > 0, fields };
    }
  
    OWP.forceLinuxPlatform = Object.freeze({
      linuxUserAgent,
      linuxAppVersion,
      createLinuxUserAgentData,
      applyForceLinuxPlatform
    });
  })(OWP);
  

  // ---- src/runtime-discovery.js ----
  ((OWP) => {
    'use strict';
  
    function sleep(windowObject, milliseconds) {
      return new Promise((resolve) => windowObject.setTimeout(resolve, milliseconds));
    }
  
    async function waitForRuntimeApi(windowObject, timeoutMs = OWP.constants.API_WAIT_TIMEOUT_MS) {
      const startedAt = Date.now();
      while (Date.now() - startedAt <= timeoutMs) {
        const api = windowObject?.api?.runtimeEnvironments;
        if (api?.list && api?.getStatus && api?.call) return api;
        await sleep(windowObject, OWP.constants.API_POLL_INTERVAL_MS);
      }
      return null;
    }
  
    function unwrapEnvelope(envelope) {
      if (!envelope || typeof envelope !== 'object' || envelope.ok !== true) return null;
      return envelope.result && typeof envelope.result === 'object' ? envelope.result : null;
    }
  
    async function discoverRuntime(windowObject, expectedEnvironment) {
      const api = await waitForRuntimeApi(windowObject);
      if (!api) return { ok: false, reason: 'runtime-api-unavailable' };
  
      let environments;
      try {
        environments = await api.list();
      } catch {
        return { ok: false, reason: 'runtime-environment-list-failed' };
      }
      const environment = Array.isArray(environments)
        ? environments.find((entry) => entry?.id === expectedEnvironment?.environmentId)
        : null;
      if (!environment) return { ok: false, reason: 'runtime-environment-mismatch' };
  
      let statusEnvelope;
      try {
        statusEnvelope = await api.getStatus({
          selector: environment.id,
          timeoutMs: OWP.constants.RUNTIME_CALL_TIMEOUT_MS
        });
      } catch {
        return { ok: false, reason: 'runtime-status-failed' };
      }
      const status = unwrapEnvelope(statusEnvelope);
      if (!status) return { ok: false, reason: 'runtime-status-rejected' };
  
      const runtimeId = typeof status.runtimeId === 'string' && status.runtimeId
        ? status.runtimeId
        : typeof statusEnvelope?._meta?.runtimeId === 'string'
          ? statusEnvelope._meta.runtimeId
          : null;
      if (!runtimeId) return { ok: false, reason: 'runtime-id-missing' };
  
      let platform = OWP.runtimeProfile.isValidPlatform(status.hostPlatform)
        ? status.hostPlatform
        : null;
      if (!platform) {
        let platformEnvelope;
        try {
          platformEnvelope = await api.call({
            selector: environment.id,
            method: 'host.platform',
            timeoutMs: OWP.constants.RUNTIME_CALL_TIMEOUT_MS
          });
        } catch {
          return { ok: false, reason: 'host-platform-call-failed' };
        }
        const platformResult = unwrapEnvelope(platformEnvelope);
        platform = platformResult?.platform;
      }
      if (!OWP.runtimeProfile.isValidPlatform(platform)) {
        return { ok: false, reason: 'host-platform-invalid' };
      }
  
      const appVersion = typeof status.appVersion === 'string' && status.appVersion.trim()
        ? status.appVersion.trim()
        : null;
  
      return {
        ok: true,
        runtimeId,
        platform,
        appVersion
      };
    }
  
    OWP.runtimeDiscovery = Object.freeze({ waitForRuntimeApi, unwrapEnvelope, discoverRuntime });
  })(OWP);
  

  // ---- src/main.js ----
  ((OWP) => {
    'use strict';
  
    const state = {
      scriptVersion: OWP.constants.SCRIPT_VERSION,
      environmentFound: false,
      bootstrapProfile: null,
      bootstrapPatchApplied: false,
      bootstrapPatchFields: [],
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
        recheck: () => revalidate(windowObject),
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
  
    async function revalidate(windowObject) {
      const environment = OWP.runtimeProfile.readCurrentEnvironment(windowObject.localStorage);
      if (!environment) {
        state.lastDiscovery = { ok: false, reason: 'orca-environment-not-found' };
        return state.lastDiscovery;
      }
      const discovered = await OWP.runtimeDiscovery.discoverRuntime(windowObject, environment);
      state.lastDiscovery = summarizeDiscovery(discovered);
      if (!discovered.ok) {
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
        state.lastDiscovery = { ok: false, reason: 'runtime-profile-cache-write-failed' };
        return state.lastDiscovery;
      }
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
      void revalidate(windowObject);
      return state;
    }
  
    OWP.main = Object.freeze({ start, revalidate, wantsLinuxPatch, requestBoundedReload });
    start();
  })(OWP);
  
})();
