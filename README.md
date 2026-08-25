# Orca Web Patches

Browser-side compatibility patches for [Orca Web](https://github.com/stablyai/orca), initially delivered as one Tampermonkey userscript.

The repository intentionally separates patch policy from local deployment configuration. Hostnames, URLs, ports, paired runtime identities, and runtime caches stay in the browser; they are not repository configuration.

## What v0.1.0 fixes

When Orca Web runs in a Windows browser but is paired to a Linux Orca runtime, some web-side code derives platform information from the browser. The first patch makes page-visible browser platform identity Linux **only after the connected Orca runtime has been verified as Linux**.

It adjusts `navigator.platform`, the OS portion of `navigator.userAgent` / `appVersion`, and Chromium `navigator.userAgentData`. Browser identity/version is preserved: Edge remains Edge, Chrome remains Chrome. It does not rewrite network request headers.

## Install

1. Install Tampermonkey in Edge/Chromium.
2. Allow userscripts. On Edge, `edge://extensions` → Developer mode satisfies the current Chromium userscript permission requirement.
3. In Tampermonkey settings, `Content Script API = UserScripts API Dynamic` is recommended. This provides genuine `document-start` execution needed by bootstrap patches.
4. Install `dist/orca-web-patches.user.js`. Once published on GitHub, opening its raw URL installs it and Tampermonkey can update it from the `@updateURL` / `@downloadURL` metadata.

The committed metadata runs on `localhost` and `127.0.0.1` over HTTP/HTTPS, with no port assumption. For another Orca Web origin, add that origin under the script's Tampermonkey **User matches**. This is local browser configuration and is not overwritten by repository updates.

The script still no-ops unless Orca Web's own local paired-runtime environment is present.

## First use and runtime detection

The platform patch must execute at `document-start`, but authoritative runtime information becomes available later. v0.1.0 handles that without assuming Linux:

1. At `document-start`, read only a fresh local runtime profile whose saved Orca environment identity still matches the current pairing.
2. If that profile says Linux and the patch registry allows the patch, apply it immediately.
3. If no trustworthy profile exists, do not spoof anything.
4. After Orca Web installs its browser API, query the selected environment with `runtimeEnvironments.getStatus`; use `status.hostPlatform` when available and otherwise call the runtime's `host.platform` RPC.
5. Cache only non-secret identity/platform/version data. The Orca pairing token is never copied into the patch cache.
6. If the newly verified state requires a different bootstrap decision, reload once. A session guard prevents a reload loop.
7. Revalidate on later loads. Switching a paired endpoint/runtime from Linux to Windows therefore corrects the cache and removes the spoof on the next bootstrap.

The profile cache expires after six hours. Expired, malformed, identity-mismatched, or conflicting profiles fail closed.

## Verify

In Edge DevTools → Console:

```js
({
  platform: navigator.platform,
  userAgent: navigator.userAgent,
  uaDataPlatform: navigator.userAgentData?.platform,
  patches: window.__orcaWebPatches?.getStatus(),
})
```

On a verified Linux runtime, expect `Linux x86_64`, a UA containing `(X11; Linux x86_64)` while retaining its browser token such as `Edg/...`, and UA Client Hints platform `Linux`.

Add `?orcaWebPatchesDebug=1` to the page URL for concise debug logging. Normal operation is quiet.

Useful diagnostics:

```js
await window.__orcaWebPatches?.recheck()
window.__orcaWebPatches?.clearCache()
```

`clearCache()` removes only this userscript's runtime profile and reload guard; it does not delete Orca's pairing.

## Update behavior

Tampermonkey compares the userscript `@version` and downloads newer releases from the raw GitHub `main` artifact. Every userscript change must increase `package.json` / metadata version and regenerate `dist/orca-web-patches.user.js`.

## Development

Requires Node.js 20+ and no third-party packages.

```sh
npm run check
```

This runs the deterministic tests, rebuilds the userscript, syntax-checks the generated artifact, and rejects known private/deployment-specific data patterns.

See [docs/compatibility.md](docs/compatibility.md) for version evidence and patch retirement policy.

## Rollback

Disable or uninstall the Tampermonkey script. No Orca runtime, repository, server configuration, or network headers are modified.
