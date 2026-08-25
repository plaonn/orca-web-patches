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
      id: 'force-linux-platform',
      phase: 'bootstrap',
      appliesTo: Object.freeze({
        platforms: Object.freeze(['linux']),
        versionRange: null,
        probe: 'browser-runtime-platform-mismatch'
      }),
      unknownVersionBehavior: 'apply',
      unknownProbeBehavior: 'apply',
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

    const platforms = patch.appliesTo?.platforms ?? [];
    if (platforms.length > 0 && !platforms.includes(profile.platform)) {
      return { patchId: patch.id, selected: false, reason: 'platform-mismatch' };
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
})(globalThis.__OWP__);
