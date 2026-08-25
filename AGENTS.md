# AGENTS.md

## Purpose

This repository owns a browser-side compatibility layer for Orca Web. It is not an Orca fork and does not own Orca runtime behavior.

## Source-of-truth boundaries

- Repository truth: generic patch code, patch applicability metadata, runtime discovery logic, deterministic build/tests, public documentation, and synthetic fixtures.
- Local/browser truth: Orca URL/hostname/port, Tampermonkey execution-scope overrides (`User includes` / `User matches` / `User excludes` and original-match merge settings), paired-runtime identity, detected platform/version cache, and per-device overrides.
- Upstream truth: Orca's runtime/Web API and release behavior in `stablyai/orca`.

Never commit user-specific endpoints, port lists, runtime IDs, browser-profile data, pairing tokens, credentials, private hostnames, Todoist IDs, or local absolute paths.

## Patch rules

- Backend/runtime platform is authoritative. Browser OS or URL shape is not evidence of backend platform.
- Bootstrap patches may use only a fresh, identity-bound local cache. Unknown, stale, malformed, or conflicting state fails closed.
- Runtime discovery should use existing Orca Web APIs before inventing a private transport.
- Prefer independently authored interoperability/patch code based on observed behavior and runtime/Web contracts. Do not copy upstream Orca implementation into this repository merely for convenience.
- If a future patch genuinely requires copying copyrighted upstream code, review license compatibility first and preserve all notices required by the upstream license.
- Record confirmed affected versions separately from conservative apply-until-fixed policy.
- Do not mark a patch fixed or retired without direct upstream/release evidence.
- Keep patches independently testable and avoid unrelated browser/network mutation.

## Deployment configuration

- Do not encode a user's real Orca hostnames, URLs, or ports in source metadata, fixtures, examples, or tests.
- Treat the userscript metadata match list as generic installation defaults, not as a user's canonical deployment scope.
- The canonical per-browser execution scope belongs in Tampermonkey-local include/match/exclude overrides. Documentation should prefer disabling broad original matches and adding exact local `User includes` when a user wants strict host/port scoping.
- Userscript updates must remain independent from per-browser URL/port configuration.

## Delivery

- `src/` is canonical source.
- `dist/orca-web-patches.user.js` is a deterministic generated installation artifact and is committed for stable raw-GitHub Tampermonkey updates.
- Run `npm run check` before integration.
- Actual Edge/Tampermonkey acceptance is a separate evidence axis from unit/build checks.
