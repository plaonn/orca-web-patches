// ==UserScript==
// @name         Orca Web Patches
// @namespace    https://github.com/plaonn/orca-web-patches
// @version      0.2.5
// @description  Version-aware compatibility patches for Orca Web.
// @license      MIT
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
      SCRIPT_VERSION: '0.2.5',
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
  
    function normalizeBrowserPlatform(value) {
      if (typeof value !== 'string' || !value.trim()) return null;
      const normalized = value.trim().toLowerCase();
      if (normalized.includes('android')) return 'android';
      if (normalized.includes('win')) return 'win32';
      if (normalized.includes('mac')) return 'darwin';
      if (normalized.includes('linux')) return 'linux';
      return null;
    }
  
    const PROBES = Object.freeze({
      'browser-runtime-platform-mismatch': Object.freeze({
        evaluate(profile, context = {}) {
          const browserPlatform = normalizeBrowserPlatform(context.browserPlatform);
          if (!browserPlatform || typeof profile?.platform !== 'string') return null;
          return browserPlatform !== profile.platform;
        }
      })
    });
  
    const PATCHES = Object.freeze([
      Object.freeze({
        id: 'align-browser-platform-to-runtime',
        phase: 'bootstrap',
        appliesTo: Object.freeze({
          runtimePlatforms: Object.freeze(['linux', 'darwin']),
          browserPlatforms: Object.freeze(['win32']),
          versionRange: null,
          probe: 'browser-runtime-platform-mismatch'
        }),
        unknownVersionBehavior: 'apply',
        unknownProbeBehavior: 'skip',
        applyUntilFixed: true,
        evidence: Object.freeze({
          confirmedAffected: Object.freeze(['1.4.188']),
          confirmedAffectedContexts: Object.freeze([
            Object.freeze({ browserPlatform: 'win32', runtimePlatform: 'linux' }),
            Object.freeze({ browserPlatform: 'win32', runtimePlatform: 'darwin' })
          ]),
          upstreamSourceObservedAt: 'cc4801320a75f2fd87f67454e13dae7a63117097',
          fixedIn: null
        }),
        rationale: 'Align page-visible browser platform identity with the authoritative connected runtime when a verified affected browser/runtime combination requires it.'
      }),
      Object.freeze({
        id: 'project-paired-runtime-authority',
        phase: 'bootstrap',
        appliesTo: Object.freeze({
          runtimePlatforms: Object.freeze([]),
          browserPlatforms: Object.freeze([]),
          versionRange: null,
          probe: null
        }),
        unknownVersionBehavior: 'skip',
        unknownProbeBehavior: 'skip',
        applyUntilFixed: true,
        evidence: Object.freeze({
          confirmedAffected: Object.freeze(['1.4.188']),
          confirmedAffectedContexts: Object.freeze([
            Object.freeze({ client: 'web', runtime: 'paired', operation: 'runtime-target-selection' })
          ]),
          upstreamSourceObservedAt: '894ce0157dcc20dc2e0bb8cf74c97a769c61c5ac',
          fixedIn: null
        }),
        rationale: 'Project the paired Web environment into settings reads without persisting a server preference so renderer runtime-target selection does not fall back to a nonexistent client-local host.'
      }),
      Object.freeze({
        id: 'bridge-web-runtime-settings',
        phase: 'runtime',
        appliesTo: Object.freeze({
          runtimePlatforms: Object.freeze([]),
          browserPlatforms: Object.freeze([]),
          versionRange: null,
          probe: null
        }),
        unknownVersionBehavior: 'skip',
        unknownProbeBehavior: 'skip',
        applyUntilFixed: true,
        evidence: Object.freeze({
          confirmedAffected: Object.freeze(['1.4.188']),
          confirmedAffectedContexts: Object.freeze([
            Object.freeze({ client: 'web', runtime: 'paired' })
          ]),
          upstreamSourceObservedAt: '4218d5068e252fc4d6db4b146b92716f1b015039',
          fixedIn: null
        }),
        rationale: 'Forward runtime-supported settings that Orca Web persists locally but omits from settings.update when paired to a runtime.'
      }),
      Object.freeze({
        id: 'bridge-web-project-groups',
        phase: 'runtime',
        appliesTo: Object.freeze({
          runtimePlatforms: Object.freeze([]),
          browserPlatforms: Object.freeze([]),
          versionRange: null,
          probe: null
        }),
        unknownVersionBehavior: 'skip',
        unknownProbeBehavior: 'skip',
        applyUntilFixed: true,
        evidence: Object.freeze({
          confirmedAffected: Object.freeze(['1.4.188']),
          confirmedAffectedContexts: Object.freeze([
            Object.freeze({ client: 'web', runtime: 'paired', operation: 'project-groups' })
          ]),
          upstreamSourceObservedAt: '894ce0157dcc20dc2e0bb8cf74c97a769c61c5ac',
          fixedIn: null
        }),
        rationale: 'Fill the missing projectGroups preload namespace only for the nonexistent client-local catalog; runtime-owned mutations must route through the renderer runtime target instead of being restamped as local.'
      }),
      Object.freeze({
        id: 'qualify-runtime-worktree-removal-host',
        phase: 'runtime',
        appliesTo: Object.freeze({
          runtimePlatforms: Object.freeze([]),
          browserPlatforms: Object.freeze([]),
          versionRange: null,
          probe: null
        }),
        unknownVersionBehavior: 'skip',
        unknownProbeBehavior: 'skip',
        applyUntilFixed: true,
        evidence: Object.freeze({
          confirmedAffected: Object.freeze(['1.4.188']),
          confirmedAffectedContexts: Object.freeze([
            Object.freeze({ client: 'web', runtime: 'paired', operation: 'worktree.rm' })
          ]),
          upstreamSourceObservedAt: '32df073e445ccc4e294be6cc71668f5aaa00ceec',
          fixedIn: null
        }),
        rationale: 'Backport upstream paired-runtime worktree removal host qualification so a runtime-local host id is not sent back to the same runtime as a foreign host selector.'
      })
    ]);
  
    function getPatch(id) {
      return PATCHES.find((patch) => patch.id === id) ?? null;
    }
  
    function unknownDecision(behavior) {
      return behavior === 'apply';
    }
  
    function matchesVersion(patch, appVersion) {
      if (typeof appVersion !== 'string' || OWP.versioning.parseSemver(appVersion) === null) {
        return {
          matches: unknownDecision(patch.unknownVersionBehavior),
          reason: 'version-unknown'
        };
      }
  
      const range = patch.appliesTo?.versionRange ?? null;
      if (range?.minInclusive) {
        const compared = OWP.versioning.compareSemver(appVersion, range.minInclusive);
        if (compared === null) {
          return { matches: unknownDecision(patch.unknownVersionBehavior), reason: 'version-range-unknown' };
        }
        if (compared < 0) return { matches: false, reason: 'version-before-range' };
      }
  
      if (range?.maxExclusive) {
        const compared = OWP.versioning.compareSemver(appVersion, range.maxExclusive);
        if (compared === null) {
          return { matches: unknownDecision(patch.unknownVersionBehavior), reason: 'version-range-unknown' };
        }
        if (compared >= 0) return { matches: false, reason: 'version-after-range' };
      }
  
      const fixedIn = patch.evidence?.fixedIn ?? null;
      if (fixedIn) {
        const compared = OWP.versioning.compareSemver(appVersion, fixedIn);
        if (compared === null) {
          return { matches: unknownDecision(patch.unknownVersionBehavior), reason: 'fixed-version-unknown' };
        }
        if (compared >= 0) return { matches: false, reason: 'upstream-fixed' };
      }
  
      if (range?.minInclusive || range?.maxExclusive) {
        return { matches: true, reason: 'version-in-range' };
      }
  
      if (patch.applyUntilFixed === true) {
        return { matches: true, reason: 'version-before-known-fix' };
      }
  
      const confirmed = patch.evidence?.confirmedAffected ?? [];
      return {
        matches: confirmed.includes(appVersion),
        reason: confirmed.includes(appVersion) ? 'version-confirmed-affected' : 'version-not-confirmed'
      };
    }
  
    function evaluateProbe(patch, profile, context) {
      const probeId = patch.appliesTo?.probe ?? null;
      if (!probeId) return { matches: true, reason: 'probe-not-required' };
  
      const probe = PROBES[probeId];
      if (!probe) {
        return {
          matches: unknownDecision(patch.unknownProbeBehavior),
          reason: 'probe-unavailable'
        };
      }
  
      let result = null;
      try {
        result = probe.evaluate(profile, context);
      } catch {
        result = null;
      }
  
      if (result === true) return { matches: true, reason: `probe:${probeId}:match` };
      if (result === false) return { matches: false, reason: `probe:${probeId}:no-match` };
      return {
        matches: unknownDecision(patch.unknownProbeBehavior),
        reason: `probe:${probeId}:unknown`
      };
    }
  
    function evaluatePatch(patch, profile, context = {}) {
      if (!patch || !profile) {
        return { patchId: patch?.id ?? null, selected: false, reason: 'profile-missing' };
      }
  
      const runtimePlatforms = patch.appliesTo?.runtimePlatforms ?? [];
      if (runtimePlatforms.length > 0 && !runtimePlatforms.includes(profile.platform)) {
        return { patchId: patch.id, selected: false, reason: 'runtime-platform-mismatch' };
      }
  
      const browserPlatforms = patch.appliesTo?.browserPlatforms ?? [];
      if (browserPlatforms.length > 0) {
        const browserPlatform = normalizeBrowserPlatform(context.browserPlatform);
        if (!browserPlatform) {
          return { patchId: patch.id, selected: false, reason: 'browser-platform-unknown' };
        }
        if (!browserPlatforms.includes(browserPlatform)) {
          return { patchId: patch.id, selected: false, reason: 'browser-platform-mismatch' };
        }
      }
  
      const version = matchesVersion(patch, profile.appVersion);
      if (!version.matches) {
        return { patchId: patch.id, selected: false, reason: version.reason };
      }
  
      const probe = evaluateProbe(patch, profile, context);
      if (!probe.matches) {
        return { patchId: patch.id, selected: false, reason: probe.reason };
      }
  
      return {
        patchId: patch.id,
        selected: true,
        reason: probe.reason === 'probe-not-required' ? version.reason : probe.reason
      };
    }
  
    function shouldApplyPatch(patch, profile, context = {}) {
      return evaluatePatch(patch, profile, context).selected;
    }
  
    function selectPatches(profile, context = {}, options = {}) {
      const phase = options.phase ?? null;
      const candidates = phase ? PATCHES.filter((patch) => patch.phase === phase) : PATCHES;
      const decisions = candidates.map((patch) => evaluatePatch(patch, profile, context));
      const selected = candidates.filter((patch, index) => decisions[index].selected);
      return { selected, decisions };
    }
  
    OWP.patchRegistry = Object.freeze({
      PATCHES,
      PROBES,
      normalizeBrowserPlatform,
      getPatch,
      matchesVersion,
      evaluatePatch,
      shouldApplyPatch,
      selectPatches
    });
  })(OWP);
  

  // ---- src/patches/align-browser-platform-to-runtime.js ----
  ((OWP) => {
    'use strict';
  
    const TARGET_IDENTITIES = Object.freeze({
      linux: Object.freeze({
        navigatorPlatform: 'Linux x86_64',
        userAgentPlatform: 'X11; Linux x86_64',
        userAgentDataPlatform: 'Linux',
        platformVersion: '0.0.0'
      }),
      darwin: Object.freeze({
        navigatorPlatform: 'MacIntel',
        userAgentPlatform: 'Macintosh; Intel Mac OS X 10_15_7',
        userAgentDataPlatform: 'macOS',
        platformVersion: '0.0.0'
      })
    });
  
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
  
    function rewritePlatformTuple(value, targetIdentity) {
      if (typeof value !== 'string' || !targetIdentity) return value;
      const knownPlatformTuple = /\((?:Windows NT [^)]+|X11; Linux [^)]+|Macintosh; Intel Mac OS X [^)]+)\)/;
      return knownPlatformTuple.test(value)
        ? value.replace(knownPlatformTuple, `(${targetIdentity.userAgentPlatform})`)
        : value;
    }
  
    function createAlignedUserAgentData(original, targetIdentity) {
      if (!original || typeof original !== 'object' || !targetIdentity) return original;
      return new Proxy(original, {
        get(target, property) {
          if (property === 'platform') return targetIdentity.userAgentDataPlatform;
          if (property === 'getHighEntropyValues') {
            return async (hints = []) => {
              const originalMethod = Reflect.get(target, property, target);
              const result = typeof originalMethod === 'function'
                ? await originalMethod.call(target, hints)
                : {};
              const next = { ...result };
              if (hints.includes('platform')) next.platform = targetIdentity.userAgentDataPlatform;
              if (hints.includes('platformVersion')) next.platformVersion = targetIdentity.platformVersion;
              return next;
            };
          }
          if (property === 'toJSON') {
            return () => {
              const method = Reflect.get(target, property, target);
              const result = typeof method === 'function' ? method.call(target) : {};
              return { ...result, platform: targetIdentity.userAgentDataPlatform };
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    }
  
    function applyAlignBrowserPlatformToRuntime(
      navigatorObject = globalThis.navigator,
      runtimePlatform
    ) {
      if (!navigatorObject) return { applied: false, fields: [], reason: 'navigator-unavailable' };
      const targetIdentity = TARGET_IDENTITIES[runtimePlatform] ?? null;
      if (!targetIdentity) {
        return { applied: false, fields: [], reason: 'unsupported-runtime-platform' };
      }
  
      const fields = [];
      const userAgent = rewritePlatformTuple(navigatorObject.userAgent, targetIdentity);
      const appVersion = rewritePlatformTuple(navigatorObject.appVersion, targetIdentity);
  
      if (defineNavigatorValue(navigatorObject, 'platform', targetIdentity.navigatorPlatform)) {
        fields.push('platform');
      }
      if (typeof userAgent === 'string' && defineNavigatorValue(navigatorObject, 'userAgent', userAgent)) {
        fields.push('userAgent');
      }
      if (typeof appVersion === 'string' && defineNavigatorValue(navigatorObject, 'appVersion', appVersion)) {
        fields.push('appVersion');
      }
      if (navigatorObject.userAgentData) {
        const proxy = createAlignedUserAgentData(navigatorObject.userAgentData, targetIdentity);
        if (defineNavigatorValue(navigatorObject, 'userAgentData', proxy)) fields.push('userAgentData');
      }
  
      return {
        applied: fields.length > 0,
        fields,
        reason: fields.length > 0 ? 'aligned' : 'no-fields-aligned'
      };
    }
  
    OWP.alignBrowserPlatformToRuntime = Object.freeze({
      TARGET_IDENTITIES,
      rewritePlatformTuple,
      createAlignedUserAgentData,
      applyAlignBrowserPlatformToRuntime
    });
  })(OWP);
  

  // ---- src/patches/project-paired-runtime-authority.js ----
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
  })(OWP);
  

  // ---- src/patches/bridge-web-runtime-settings.js ----
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
  })(OWP);
  

  // ---- src/patches/bridge-web-project-groups.js ----
  ((OWP) => {
    'use strict';
  
    const NAMESPACE_MARKER = '__orcaWebPatchesProjectGroupsBridgeV2';
    const REWRAP_INTERVAL_MS = 250;
  
    const patchState = {
      installed: false,
      watcherInstalled: false,
      wrapCount: 0,
      localListCallCount: 0,
      rejectedMutationCount: 0,
      lastRejectedMutation: null,
      lastError: null
    };
  
    let watcherHandle = null;
    let activeWindowObject = null;
  
    function readPairedEnvironment(windowObject) {
      if (windowObject?.__ORCA_WEB_CLIENT__ !== true) return null;
      try {
        return OWP.runtimeProfile.readCurrentEnvironment(windowObject.localStorage);
      } catch {
        return null;
      }
    }
  
    function rejectLocalMutation(method) {
      patchState.rejectedMutationCount += 1;
      patchState.lastRejectedMutation = method;
      const error = new Error(
        `Paired Orca Web project-group mutation reached the local route: ${method}`
      );
      patchState.lastError = error.message;
      throw error;
    }
  
    function createProjectGroupsBridge(fallbackNamespace) {
      const bridge = {
        list: async () => {
          patchState.localListCallCount += 1;
          return [];
        },
        create: async () => rejectLocalMutation('create'),
        update: async () => rejectLocalMutation('update'),
        delete: async () => rejectLocalMutation('delete'),
        moveProject: async () => rejectLocalMutation('moveProject')
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
      if (!windowObject.api) {
        patchState.installed = false;
        return { applied: false, reason: 'orca-api-unavailable' };
      }
      if (windowObject.api.projectGroups?.[NAMESPACE_MARKER] === true) {
        patchState.installed = true;
        return { applied: true, reason: 'already-installed' };
      }
  
      const fallbackNamespace = windowObject.api.projectGroups;
      const bridge = createProjectGroupsBridge(fallbackNamespace);
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
          ...(installed.applied ? ['projectGroups.list(empty-local-catalog)', 'projectGroups.local-mutations(fail-closed)'] : []),
          ...(patchState.watcherInstalled ? ['project-groups-api-rewrap-watcher'] : [])
        ],
        reason: installed.reason
      };
    }
  
    OWP.bridgeWebProjectGroups = Object.freeze({
      readPairedEnvironment,
      rejectLocalMutation,
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
  })(OWP);
  

  // ---- src/patches/qualify-runtime-worktree-removal-host.js ----
  ((OWP) => {
    'use strict';
  
    const CALL_MARKER = '__orcaWebPatchesWorktreeRemovalHostQualificationV1';
    const REMOVE_MARKER = '__orcaWebPatchesWorktreeRemoveQualificationV1';
    const REWRAP_INTERVAL_MS = 250;
  
    const patchState = {
      installed: false,
      watcherInstalled: false,
      runtimeCallWrapped: false,
      worktreesRemoveWrapped: false,
      runtimeCallWrapCount: 0,
      worktreesRemoveWrapCount: 0,
      observedRuntimeCallCount: 0,
      observedWorktreesRemoveCount: 0,
      rewrittenCallCount: 0,
      rewrittenWorktreesRemoveCount: 0,
      lastRewrittenSelector: null,
      lastRewrittenHostId: null,
      lastRewriteSurface: null,
      lastError: null
    };
  
    let watcherHandle = null;
    let activeWindowObject = null;
  
    function parseRuntimeEnvironmentId(hostId) {
      if (typeof hostId !== 'string' || !hostId.startsWith('runtime:')) return null;
      const encoded = hostId.slice('runtime:'.length);
      if (!encoded) return null;
      try {
        const decoded = decodeURIComponent(encoded);
        return decoded || null;
      } catch {
        return null;
      }
    }
  
    function readActiveEnvironmentId(windowObject) {
      try {
        const raw = windowObject.localStorage?.getItem?.(OWP.constants.ORCA_ENVIRONMENT_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return typeof parsed?.id === 'string' && parsed.id.trim() ? parsed.id.trim() : null;
      } catch {
        return null;
      }
    }
  
    function qualifyCallRequest(request) {
      if (!request || typeof request !== 'object' || request.method !== 'worktree.rm') {
        return { request, rewritten: false };
      }
      if (!request.params || typeof request.params !== 'object') {
        return { request, rewritten: false };
      }
  
      const runtimeEnvironmentId = parseRuntimeEnvironmentId(request.params.hostId);
      if (!runtimeEnvironmentId || runtimeEnvironmentId !== request.selector) {
        return { request, rewritten: false };
      }
  
      const params = { ...request.params };
      const removedHostId = params.hostId;
      delete params.hostId;
      return {
        request: { ...request, params },
        rewritten: true,
        removedHostId
      };
    }
  
    function qualifyWorktreesRemoveArgs(windowObject, args) {
      if (!args || typeof args !== 'object') return { args, rewritten: false };
      const activeEnvironmentId = readActiveEnvironmentId(windowObject);
      const runtimeEnvironmentId = parseRuntimeEnvironmentId(args.hostId);
      if (!activeEnvironmentId || !runtimeEnvironmentId || runtimeEnvironmentId !== activeEnvironmentId) {
        return { args, rewritten: false };
      }
  
      const nextArgs = { ...args };
      const removedHostId = nextArgs.hostId;
      delete nextArgs.hostId;
      return {
        args: nextArgs,
        rewritten: true,
        removedHostId,
        selector: activeEnvironmentId
      };
    }
  
    function wrapRuntimeCall(windowObject) {
      const runtimeEnvironments = windowObject.api?.runtimeEnvironments;
      if (!runtimeEnvironments || typeof runtimeEnvironments.call !== 'function') {
        patchState.runtimeCallWrapped = false;
        return { applied: false, reason: 'runtime-call-api-unavailable' };
      }
      if (runtimeEnvironments.call?.[CALL_MARKER] === true) {
        patchState.runtimeCallWrapped = true;
        return { applied: true, reason: 'already-installed' };
      }
  
      const originalCall = runtimeEnvironments.call;
      const wrappedCall = function qualifiedRuntimeCall(...args) {
        patchState.observedRuntimeCallCount += 1;
        const qualified = qualifyCallRequest(args[0]);
        if (qualified.rewritten) {
          patchState.rewrittenCallCount += 1;
          patchState.lastRewrittenSelector = qualified.request.selector ?? null;
          patchState.lastRewrittenHostId = qualified.removedHostId ?? null;
          patchState.lastRewriteSurface = 'runtimeEnvironments.call';
          args[0] = qualified.request;
        }
        try {
          return Reflect.apply(originalCall, runtimeEnvironments, args);
        } catch (error) {
          patchState.lastError = error instanceof Error ? error.message : String(error);
          throw error;
        }
      };
      Object.defineProperty(wrappedCall, CALL_MARKER, { value: true });
  
      try {
        runtimeEnvironments.call = wrappedCall;
      } catch {
        // Fall through to defineProperty for stricter preload surfaces.
      }
      if (runtimeEnvironments.call !== wrappedCall) {
        try {
          Object.defineProperty(runtimeEnvironments, 'call', {
            value: wrappedCall,
            configurable: true,
            writable: true
          });
        } catch {
          patchState.runtimeCallWrapped = false;
          return { applied: false, reason: 'runtime-call-not-writable' };
        }
      }
  
      patchState.runtimeCallWrapped = true;
      patchState.runtimeCallWrapCount += 1;
      return { applied: true, reason: 'installed' };
    }
  
    function wrapWorktreesRemove(windowObject) {
      const worktrees = windowObject.api?.worktrees;
      if (!worktrees || typeof worktrees.remove !== 'function') {
        patchState.worktreesRemoveWrapped = false;
        return { applied: false, reason: 'worktrees-remove-api-unavailable' };
      }
      if (worktrees.remove?.[REMOVE_MARKER] === true) {
        patchState.worktreesRemoveWrapped = true;
        return { applied: true, reason: 'already-installed' };
      }
  
      const originalRemove = worktrees.remove;
      const wrappedRemove = function qualifiedWorktreesRemove(...args) {
        patchState.observedWorktreesRemoveCount += 1;
        const qualified = qualifyWorktreesRemoveArgs(windowObject, args[0]);
        if (qualified.rewritten) {
          patchState.rewrittenWorktreesRemoveCount += 1;
          patchState.lastRewrittenSelector = qualified.selector ?? null;
          patchState.lastRewrittenHostId = qualified.removedHostId ?? null;
          patchState.lastRewriteSurface = 'worktrees.remove';
          args[0] = qualified.args;
        }
        try {
          return Reflect.apply(originalRemove, worktrees, args);
        } catch (error) {
          patchState.lastError = error instanceof Error ? error.message : String(error);
          throw error;
        }
      };
      Object.defineProperty(wrappedRemove, REMOVE_MARKER, { value: true });
  
      try {
        worktrees.remove = wrappedRemove;
      } catch {
        // Fall through to defineProperty for stricter preload surfaces.
      }
      if (worktrees.remove !== wrappedRemove) {
        try {
          Object.defineProperty(worktrees, 'remove', {
            value: wrappedRemove,
            configurable: true,
            writable: true
          });
        } catch {
          patchState.worktreesRemoveWrapped = false;
          return { applied: false, reason: 'worktrees-remove-not-writable' };
        }
      }
  
      patchState.worktreesRemoveWrapped = true;
      patchState.worktreesRemoveWrapCount += 1;
      return { applied: true, reason: 'installed' };
    }
  
    function ensureCurrentWrappers(windowObject = activeWindowObject) {
      if (!windowObject) return { applied: false, reason: 'window-unavailable' };
      const runtimeResult = wrapRuntimeCall(windowObject);
      const removeResult = wrapWorktreesRemove(windowObject);
      const applied = runtimeResult.applied || removeResult.applied;
      patchState.installed = applied;
      return {
        applied,
        runtimeResult,
        removeResult
      };
    }
  
    function installWatcher(windowObject) {
      activeWindowObject = windowObject;
      if (watcherHandle !== null) {
        patchState.watcherInstalled = true;
        return true;
      }
      if (typeof windowObject.setInterval !== 'function') {
        return false;
      }
      watcherHandle = windowObject.setInterval(() => {
        try {
          ensureCurrentWrappers(windowObject);
        } catch (error) {
          patchState.lastError = error instanceof Error ? error.message : String(error);
        }
      }, REWRAP_INTERVAL_MS);
      patchState.watcherInstalled = true;
      return true;
    }
  
    function installRuntimeRemovalQualification(windowObject) {
      activeWindowObject = windowObject;
      const ensured = ensureCurrentWrappers(windowObject);
      installWatcher(windowObject);
      return {
        applied: ensured.applied,
        fields: [
          ...(ensured.runtimeResult?.applied ? ['runtimeEnvironments.call(worktree.rm.hostId)'] : []),
          ...(ensured.removeResult?.applied ? ['worktrees.remove(hostId)'] : []),
          ...(patchState.watcherInstalled ? ['runtime-removal-api-rewrap-watcher'] : [])
        ],
        reason: ensured.applied
          ? 'installed'
          : `${ensured.runtimeResult?.reason ?? 'runtime-call-unknown'};${ensured.removeResult?.reason ?? 'worktrees-remove-unknown'}`
      };
    }
  
    function applyQualifyRuntimeWorktreeRemovalHost(windowObject) {
      return installRuntimeRemovalQualification(windowObject);
    }
  
    OWP.qualifyRuntimeWorktreeRemovalHost = Object.freeze({
      parseRuntimeEnvironmentId,
      readActiveEnvironmentId,
      qualifyCallRequest,
      qualifyWorktreesRemoveArgs,
      wrapRuntimeCall,
      wrapWorktreesRemove,
      ensureCurrentWrappers,
      installRuntimeRemovalQualification,
      applyQualifyRuntimeWorktreeRemovalHost,
      getStatus: () => {
        try {
          ensureCurrentWrappers();
        } catch {
          // Status must remain readable even if Orca is swapping its preload API.
        }
        return { ...patchState };
      }
    });
  })(OWP);
  

  // ---- src/runtime-discovery.js ----
  ((OWP) => {
    'use strict';
  
    const BRIDGE_CHANNEL = 'orca-web-patches.runtime.v1';
    const BRIDGE_PING_TIMEOUT_MS = 1_500;
    let bridgeReadyPromise = null;
  
    function sleep(windowObject, milliseconds) {
      return new Promise((resolve) => windowObject.setTimeout(resolve, milliseconds));
    }
  
    async function waitForOrcaWebClient(windowObject, timeoutMs = OWP.constants.API_WAIT_TIMEOUT_MS) {
      const startedAt = Date.now();
      while (Date.now() - startedAt <= timeoutMs) {
        if (windowObject?.__ORCA_WEB_CLIENT__ === true) return true;
        await sleep(windowObject, OWP.constants.API_POLL_INTERVAL_MS);
      }
      return false;
    }
  
    function pageBridgeBootstrap() {
      'use strict';
  
      const CHANNEL = 'orca-web-patches.runtime.v1';
      const MARKER = '__orcaWebPatchesRuntimeBridgeV1';
  
      if (window[MARKER] === true) return;
      try {
        Object.defineProperty(window, MARKER, { value: true, configurable: true });
      } catch {
        window[MARKER] = true;
      }
  
      function respond(requestId, payload) {
        window.postMessage({
          channel: CHANNEL,
          type: 'response',
          requestId,
          payload
        }, '*');
      }
  
      window.addEventListener('message', async (event) => {
        if (event.source && event.source !== window) return;
        const message = event.data;
        if (!message || message.channel !== CHANNEL || message.type !== 'request') return;
        if (typeof message.requestId !== 'string' || !message.requestId) return;
  
        if (message.action === 'ping') {
          respond(message.requestId, { ok: true, kind: 'ready' });
          return;
        }
  
        if (message.action !== 'discover') return;
        const selector = message.selector;
        if (typeof selector !== 'string' || !selector) {
          respond(message.requestId, {
            ok: false,
            reason: 'runtime-environment-invalid',
            stage: 'environment'
          });
          return;
        }
  
        const api = window.api?.runtimeEnvironments;
        if (!api?.getStatus || !api?.call) {
          respond(message.requestId, {
            ok: false,
            reason: 'runtime-api-unavailable',
            stage: 'api'
          });
          return;
        }
  
        let statusEnvelope;
        try {
          statusEnvelope = await api.getStatus({
            selector,
            timeoutMs: message.timeoutMs
          });
        } catch {
          respond(message.requestId, {
            ok: false,
            reason: 'runtime-status-failed',
            stage: 'status'
          });
          return;
        }
  
        const status = statusEnvelope?.ok === true
          && statusEnvelope.result
          && typeof statusEnvelope.result === 'object'
          ? statusEnvelope.result
          : null;
        if (!status) {
          respond(message.requestId, {
            ok: false,
            reason: 'runtime-status-rejected',
            stage: 'status'
          });
          return;
        }
  
        const runtimeId = typeof status.runtimeId === 'string' && status.runtimeId
          ? status.runtimeId
          : typeof statusEnvelope?._meta?.runtimeId === 'string'
            ? statusEnvelope._meta.runtimeId
            : null;
        if (!runtimeId) {
          respond(message.requestId, {
            ok: false,
            reason: 'runtime-id-missing',
            stage: 'status'
          });
          return;
        }
  
        let platform = typeof status.hostPlatform === 'string' && status.hostPlatform
          ? status.hostPlatform
          : null;
        if (!platform) {
          let platformEnvelope;
          try {
            platformEnvelope = await api.call({
              selector,
              method: 'host.platform',
              timeoutMs: message.timeoutMs
            });
          } catch {
            respond(message.requestId, {
              ok: false,
              reason: 'host-platform-call-failed',
              stage: 'platform'
            });
            return;
          }
          platform = platformEnvelope?.ok === true
            ? platformEnvelope.result?.platform
            : null;
        }
  
        respond(message.requestId, {
          ok: true,
          runtimeId,
          platform,
          appVersion: typeof status.appVersion === 'string' && status.appVersion.trim()
            ? status.appVersion.trim()
            : null
        });
      });
    }
  
    function installPageBridge(windowObject) {
      const documentObject = windowObject?.document;
      const target = documentObject?.documentElement ?? documentObject?.head ?? documentObject?.body;
      if (!documentObject?.createElement || !target?.appendChild) return false;
  
      const script = documentObject.createElement('script');
      script.textContent = `(${pageBridgeBootstrap.toString()})();`;
      try {
        target.appendChild(script);
        script.remove?.();
        return true;
      } catch {
        return false;
      }
    }
  
    function createRequestId() {
      return `owp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  
    function sendBridgeRequest(windowObject, request, timeoutMs) {
      return new Promise((resolve) => {
        const requestId = createRequestId();
        let settled = false;
  
        const finish = (value) => {
          if (settled) return;
          settled = true;
          windowObject.removeEventListener?.('message', onMessage);
          windowObject.clearTimeout?.(timer);
          resolve(value);
        };
  
        const onMessage = (event) => {
          if (event.source && event.source !== windowObject) return;
          const message = event.data;
          if (!message || message.channel !== BRIDGE_CHANNEL || message.type !== 'response') return;
          if (message.requestId !== requestId) return;
          finish(message.payload);
        };
  
        windowObject.addEventListener?.('message', onMessage);
        const timer = windowObject.setTimeout(() => {
          finish({ ok: false, reason: 'runtime-page-bridge-timeout', stage: 'bridge' });
        }, timeoutMs);
  
        try {
          windowObject.postMessage({
            channel: BRIDGE_CHANNEL,
            type: 'request',
            requestId,
            ...request
          }, '*');
        } catch {
          finish({ ok: false, reason: 'runtime-page-bridge-post-failed', stage: 'bridge' });
        }
      });
    }
  
    async function ensurePageBridge(windowObject) {
      if (bridgeReadyPromise) return bridgeReadyPromise;
      bridgeReadyPromise = (async () => {
        if (!installPageBridge(windowObject)) return false;
        const ping = await sendBridgeRequest(
          windowObject,
          { action: 'ping' },
          BRIDGE_PING_TIMEOUT_MS
        );
        return ping?.ok === true && ping.kind === 'ready';
      })();
  
      const ready = await bridgeReadyPromise;
      if (!ready) bridgeReadyPromise = null;
      return ready;
    }
  
    async function discoverRuntime(windowObject, expectedEnvironment) {
      const selector = expectedEnvironment?.environmentId;
      if (typeof selector !== 'string' || !selector) {
        return { ok: false, reason: 'runtime-environment-invalid', stage: 'environment' };
      }
  
      const ready = await waitForOrcaWebClient(windowObject);
      if (!ready) return { ok: false, reason: 'runtime-api-unavailable', stage: 'api' };
  
      const bridgeReady = await ensurePageBridge(windowObject);
      if (!bridgeReady) {
        return { ok: false, reason: 'runtime-page-bridge-unavailable', stage: 'bridge' };
      }
  
      const result = await sendBridgeRequest(
        windowObject,
        {
          action: 'discover',
          selector,
          timeoutMs: OWP.constants.RUNTIME_CALL_TIMEOUT_MS
        },
        (OWP.constants.RUNTIME_CALL_TIMEOUT_MS * 2) + 2_000
      );
  
      if (!result?.ok) return result ?? {
        ok: false,
        reason: 'runtime-page-bridge-invalid-response',
        stage: 'bridge'
      };
  
      if (!OWP.runtimeProfile.isValidPlatform(result.platform)) {
        return { ok: false, reason: 'host-platform-invalid', stage: 'platform' };
      }
  
      return {
        ok: true,
        runtimeId: result.runtimeId,
        platform: result.platform,
        appVersion: result.appVersion,
        transport: 'page-bridge'
      };
    }
  
    OWP.runtimeDiscovery = Object.freeze({
      waitForOrcaWebClient,
      installPageBridge,
      sendBridgeRequest,
      ensurePageBridge,
      discoverRuntime
    });
  })(OWP);
  

  // ---- src/main.js ----
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
      if (patch.id === 'project-paired-runtime-authority') {
        return OWP.projectPairedRuntimeAuthority.applyProjectPairedRuntimeAuthority(windowObject);
      }
      if (patch.id === 'bridge-web-runtime-settings') {
        return OWP.bridgeWebRuntimeSettings.applyBridgeWebRuntimeSettings(windowObject);
      }
      if (patch.id === 'bridge-web-project-groups') {
        return OWP.bridgeWebProjectGroups.applyBridgeWebProjectGroups(windowObject);
      }
      if (patch.id === 'qualify-runtime-worktree-removal-host') {
        return OWP.qualifyRuntimeWorktreeRemovalHost.applyQualifyRuntimeWorktreeRemovalHost(windowObject);
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
          if (OWP.projectPairedRuntimeAuthority?.getStatus) {
            snapshot.pairedRuntimeAuthority = OWP.projectPairedRuntimeAuthority.getStatus();
          }
          if (OWP.bridgeWebRuntimeSettings?.getStatus) {
            snapshot.runtimeSettingsBridge = OWP.bridgeWebRuntimeSettings.getStatus();
          }
          if (OWP.bridgeWebProjectGroups?.getStatus) {
            snapshot.projectGroupsBridge = OWP.bridgeWebProjectGroups.getStatus();
          }
          if (OWP.qualifyRuntimeWorktreeRemovalHost?.getStatus) {
            snapshot.worktreeRemovalHostQualification = OWP.qualifyRuntimeWorktreeRemovalHost.getStatus();
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
  })(OWP);
  
})();
