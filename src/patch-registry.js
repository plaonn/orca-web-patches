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

  const runtimePatch = (id, rationale, evidence) => Object.freeze({
    id,
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
      fixedIn: null,
      ...evidence
    }),
    rationale
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
    runtimePatch(
      'bridge-web-runtime-settings',
      'Forward runtime-supported settings that Orca Web persists locally but omits from settings.update when paired to a runtime.',
      {
        confirmedAffectedContexts: Object.freeze([
          Object.freeze({ client: 'web', runtime: 'paired' })
        ]),
        upstreamSourceObservedAt: '4218d5068e252fc4d6db4b146b92716f1b015039'
      }
    ),
    runtimePatch(
      'qualify-runtime-worktree-removal-host',
      'Backport upstream paired-runtime worktree removal host qualification so a runtime-local host id is not sent back to the same runtime as a foreign host selector.',
      {
        confirmedAffectedContexts: Object.freeze([
          Object.freeze({ client: 'web', runtime: 'paired', operation: 'worktree.rm' })
        ]),
        upstreamSourceObservedAt: '32df073e445ccc4e294be6cc71668f5aaa00ceec'
      }
    ),
    runtimePatch(
      'fill-web-project-groups-api',
      'Backfill the ProjectGroups preload namespace that paired Orca Web omits, routing supported group mutations to the paired runtime RPC surface.',
      {
        confirmedAffectedContexts: Object.freeze([
          Object.freeze({ client: 'web', runtime: 'paired', surface: 'api.projectGroups' })
        ]),
        upstreamSourceObservedAt: '61c7b51c8cc9e992dbdebc037562c208f84ac8cd'
      }
    )
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
})(globalThis.__OWP__);
