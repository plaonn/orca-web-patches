# AGENTS.md

## Purpose

This repository owns a browser-side compatibility layer for Orca Web. It is not an Orca fork and does not own Orca runtime behavior.

## Source-of-truth boundaries

- Repository truth: generic patch code, patch applicability metadata, runtime discovery logic, deterministic build/tests, public documentation, and synthetic fixtures.
- Local/browser truth: Orca URL/hostname/port, Tampermonkey User matches, paired-runtime identity, detected platform/version cache, and per-device overrides.
- Upstream truth: Orca's runtime/Web API and release behavior in `stablyai/orca`.

Never commit user-specific endpoints, port lists, runtime IDs, browser-profile data, pairing tokens, credentials, private hostnames, Todoist IDs, or local absolute paths.

## Patch rules

- Backend/runtime platform is authoritative. Browser OS or URL shape is not evidence of backend platform.
- Bootstrap patches may use only a fresh, identity-bound local cache. Unknown, stale, malformed, or conflicting state fails closed.
- Runtime discovery should use existing Orca Web APIs before inventing a private transport.
- Record confirmed affected versions separately from conservative apply-until-fixed policy.
- Do not mark a patch fixed or retired without direct upstream/release evidence.
- Keep patches independently testable and avoid unrelated browser/network mutation.

## Delivery

- `src/` is canonical source.
- `dist/orca-web-patches.user.js` is a deterministic generated installation artifact and is committed for stable raw-GitHub Tampermonkey updates.
- Run `npm run check` before integration.
- Actual Edge/Tampermonkey acceptance is a separate evidence axis from unit/build checks.
