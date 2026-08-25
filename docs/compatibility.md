# Compatibility policy

## Evidence vs application policy

A patch's `confirmedAffected` versions are evidence, not an allowlist. A patch may conservatively apply outside that set when its `applyUntilFixed` policy is true, but documentation must not describe an untested version as confirmed affected.

`force-linux-platform` currently has:

- confirmed affected runtime: Orca `1.4.188` from direct observed use;
- source-level behavior still present at upstream commit `cc4801320a75f2fd87f67454e13dae7a63117097`;
- upstream fixed version: unknown.

The source-level reason is that Orca Web's preload replacement exposes browser-derived platform data while the runtime separately exposes authoritative server platform data through `host.platform`. `status.get` also exposes runtime identity/version data.

Until a fixed release is directly established, the patch applies conservatively only when the connected runtime is verified as `linux`. Windows, macOS, unknown, stale, or conflicting runtime profiles do not qualify.

## Retirement

When upstream behavior is verified fixed:

1. record the first fixed Orca release in the patch registry;
2. add tests for versions immediately below/at/above the boundary;
3. keep malformed/unknown version behavior explicit;
4. retain historical evidence rather than rewriting old affected-version records.
