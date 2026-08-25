# Compatibility policy

## Automatic patch selection

The userscript selects patches from the registry instead of treating every patch as globally enabled. Each patch may declare:

- runtime platform constraints;
- an optional semantic-version range (`minInclusive` / `maxExclusive`);
- an optional capability/bug probe;
- explicit behavior for unknown versions and unknown probe results.

Selection is evaluated from the authoritative connected-runtime profile plus browser-side capability context captured before any bootstrap patch mutates browser identity. The debug status exposes `bootstrapSelectedPatchIds`, `bootstrapAppliedPatchIds`, and per-patch `patchDecisions` so the decision can be inspected without exposing runtime secrets.

Capability probes refine version policy rather than replacing evidence. A known fixed-version boundary always retires a patch before a probe can re-enable it. Conversely, a probe may suppress an unnecessary patch when the affected condition is absent on an otherwise eligible runtime.

## Evidence vs application policy

A patch's `confirmedAffected` versions are evidence, not an allowlist. A patch may conservatively apply outside that set when its `applyUntilFixed` policy is true, but documentation must not describe an untested version as confirmed affected.

`force-linux-platform` currently has:

- confirmed affected runtime: Orca `1.4.188` from direct observed use;
- source-level behavior still present at upstream commit `cc4801320a75f2fd87f67454e13dae7a63117097`;
- upstream fixed version: unknown;
- capability probe: connected runtime platform differs from the browser's original platform identity.

The source-level reason is that Orca Web's preload replacement exposes browser-derived platform data while the runtime separately exposes authoritative server platform data through `host.platform`. `status.get` also exposes runtime identity/version data.

Until a fixed release is directly established, the patch remains version-conservative for verified Linux runtimes, but the capability probe suppresses it when the browser is already Linux and therefore has no platform mismatch to correct. Windows, macOS, unknown, stale, or conflicting runtime profiles do not qualify as Linux runtime targets.

If the browser platform cannot be normalized, the patch's explicit `unknownProbeBehavior: apply` policy preserves the previous conservative behavior rather than silently dropping a required compatibility patch.

## Retirement

When upstream behavior is verified fixed:

1. record the first fixed Orca release in the patch registry;
2. add tests for versions immediately below/at/above the boundary;
3. keep malformed/unknown version behavior explicit;
4. retain historical evidence rather than rewriting old affected-version records.

Future patches should prefer a bounded `versionRange` when both introduction and retirement boundaries are actually known. Do not invent range boundaries from a single affected-version observation.
