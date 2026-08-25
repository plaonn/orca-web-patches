# Compatibility policy

## Automatic patch selection

The userscript selects patches from the registry instead of treating every patch as globally enabled. Each patch may declare:

- connected runtime platform constraints;
- browser platform constraints for evidence-bound browser/runtime combinations;
- an optional semantic-version range (`minInclusive` / `maxExclusive`);
- an optional capability/bug probe;
- explicit behavior for unknown versions and unknown probe results.

Selection is evaluated from the authoritative connected-runtime profile plus browser-side capability context captured before any bootstrap patch mutates browser identity. The debug status exposes `bootstrapSelectedPatchIds`, `bootstrapAppliedPatchIds`, and per-patch `patchDecisions` so the decision can be inspected without exposing runtime secrets.

Capability probes refine version and environment policy rather than replacing evidence. A known fixed-version boundary always retires a patch before a probe can re-enable it. Conversely, a probe may suppress an unnecessary patch when the affected condition is absent on an otherwise eligible environment.

## Platform-alignment patch

The generic patch identity is `align-browser-platform-to-runtime`. Its implementation accepts the authoritative runtime platform as input rather than encoding Linux in the patch name or dispatch contract.

Generic identity does not mean unbounded application. Runtime/browser target support remains evidence-driven and fail-closed. The currently verified target identity and affected combination are:

- target identity implemented: Linux;
- confirmed browser/runtime combination: Windows browser (`win32`) → Linux runtime (`linux`);
- confirmed affected runtime version: Orca `1.4.188` from direct observed use;
- source-level behavior still present at upstream commit `cc4801320a75f2fd87f67454e13dae7a63117097`;
- upstream fixed version: unknown;
- capability probe: connected runtime platform differs from the browser's original platform identity.

The source-level reason is that Orca Web's preload replacement exposes browser-derived platform data while the runtime separately exposes authoritative server platform data through `host.platform`. `status.get` also exposes runtime identity/version data.

Until a fixed release is directly established, the patch remains version-conservative for the verified Windows-browser/Linux-runtime combination. A Linux browser paired to Linux, a macOS browser paired to Linux, non-Linux runtimes, and unknown browser platform identities are not selected from the current evidence set.

Additional runtime targets may be added to the generic implementation only when their browser identity can be represented correctly and the corresponding affected browser/runtime combination has evidence. Do not infer support merely because the patch abstraction is generic.

## Evidence vs application policy

A patch's `confirmedAffected` versions are evidence, not an allowlist. A patch may conservatively apply outside that version set when its `applyUntilFixed` policy is true, but only inside its separately declared runtime/browser environment constraints. Documentation must not describe an untested version or environment pair as confirmed affected.

## Retirement

When upstream behavior is verified fixed:

1. record the first fixed Orca release in the patch registry;
2. add tests for versions immediately below/at/above the boundary;
3. keep malformed/unknown version behavior explicit;
4. retain historical evidence rather than rewriting old affected-version records.

Future patches should prefer a bounded `versionRange` when both introduction and retirement boundaries are actually known. Do not invent range boundaries from a single affected-version observation.
