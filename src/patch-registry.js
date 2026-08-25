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
})(globalThis.__OWP__);
