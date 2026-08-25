# Orca Web Patches

Browser-side compatibility patches for [Orca Web](https://github.com/stablyai/orca), initially delivered as one Tampermonkey userscript.

The repository intentionally separates patch policy from local deployment configuration. Hostnames, URLs, ports, paired runtime identities, and runtime caches stay in the browser; they are not repository configuration.

## What it fixes

When Orca Web runs in a Windows browser but is paired to a non-Windows Orca runtime, affected web-side code can derive platform information from the browser instead of the connected runtime. The `align-browser-platform-to-runtime` patch makes page-visible browser platform identity match the verified runtime for evidence-backed combinations.

Current verified combinations are Windows browser → Linux runtime and Windows browser → macOS runtime. Other browser/runtime combinations remain fail-closed until separately verified.

The patch adjusts `navigator.platform`, the OS portion of `navigator.userAgent` / `appVersion`, and Chromium `navigator.userAgentData`. Browser identity/version is preserved: Edge remains Edge, Chrome remains Chrome. It does not rewrite network request headers.

## Install

1. Install Tampermonkey in Edge/Chromium.
2. Allow userscripts. On Edge, `edge://extensions` → Developer mode satisfies the current Chromium userscript permission requirement.
3. In Tampermonkey settings, `Content Script API = UserScripts API Dynamic` is recommended. This provides genuine `document-start` execution needed by bootstrap patches.
4. Install `dist/orca-web-patches.user.js`. Opening its raw GitHub URL installs it and Tampermonkey can update it from the `@updateURL` / `@downloadURL` metadata.
5. Configure the actual Orca Web URL/port scope locally in Tampermonkey as described below.

## Local URL/port configuration

The GitHub userscript and each browser's deployment configuration are deliberately separate.

The committed metadata contains broad localhost/loopback matches only as generic installation defaults. For normal use, configure the exact Orca Web origins/ports on each browser in Tampermonkey instead of editing the userscript source:

1. Open **Tampermonkey Dashboard**.
2. Open **Orca Web Patches**.
3. Open the script's **Settings** tab.
4. Under **Includes/Excludes**, disable **Original matches** if you want the local configuration to be authoritative.
5. Add the exact Orca Web URL/port patterns for that browser under **User includes**. Use one entry per desired origin/port or a regular-expression include when a port family is intentional.
6. Save the script settings.

For example, a deployment entry can conceptually look like `http://localhost:<your-port>/*`; use the real port in Tampermonkey only, not in this repository.

`User includes`, `User matches`, `User excludes`, and the choice to merge or disable the original metadata are Tampermonkey-local overrides. Updating the userscript from GitHub therefore updates patch code without requiring the deployment URL/port list to be committed or re-edited.

Do not edit the installed userscript source merely to change URL/port scope. Source edits blur the boundary between the versioned patch artifact and per-browser deployment configuration and can interfere with clean update behavior.

The script still no-ops unless Orca Web's own local paired-runtime environment is present.

## First use and runtime detection

Bootstrap platform patches must execute at `document-start`, but authoritative runtime information becomes available later. The userscript handles that without assuming a target OS:

1. At `document-start`, read only a fresh local runtime profile whose saved Orca environment identity still matches the current pairing.
2. Run the patch registry against that verified runtime platform, Orca version, original browser platform, and patch-specific evidence policy.
3. If no trustworthy profile exists, do not spoof anything.
4. After Orca Web installs its browser API, query the selected environment through the page-realm bridge with `runtimeEnvironments.getStatus`; use `status.hostPlatform` when available and otherwise call the runtime's `host.platform` RPC.
5. Cache only non-secret identity/platform/version data. The Orca pairing token is never copied into the patch cache.
6. If the newly verified state requires a different bootstrap decision, reload once. A session guard prevents a reload loop.
7. Revalidate on later loads. Switching a paired endpoint/runtime therefore updates the cached platform and patch selection.

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

For a verified Linux runtime selected from a Windows browser, expect `Linux x86_64`, a UA containing `(X11; Linux x86_64)`, and UA Client Hints platform `Linux`.

For a verified macOS runtime selected from a Windows browser, expect `MacIntel`, a reduced Chromium macOS UA tuple containing `(Macintosh; Intel Mac OS X 10_15_7)`, and UA Client Hints platform `macOS`.

In both cases the browser token such as `Edg/...` remains unchanged.

Add `?orcaWebPatchesDebug=1` to the page URL for concise debug logging. Normal operation is quiet.

Useful diagnostics:

```js
await window.__orcaWebPatches?.recheck()
window.__orcaWebPatches?.clearCache()
```

`clearCache()` removes only this userscript's runtime profile and reload guard; it does not delete Orca's pairing or Tampermonkey's local URL/port configuration.

## Update behavior

Tampermonkey compares the userscript `@version` and downloads newer releases from the raw GitHub `main` artifact. Every userscript code change must increase `package.json` / metadata version and regenerate `dist/orca-web-patches.user.js`.

Per-browser URL/port scope remains in Tampermonkey's local override settings and is not part of the downloaded userscript artifact.

## Development

Requires Node.js 20+ and no third-party packages.

```sh
npm run check
```

This runs the deterministic tests, rebuilds the userscript, syntax-checks the generated artifact, and rejects known private/deployment-specific data patterns.

See [docs/compatibility.md](docs/compatibility.md) for version evidence and patch retirement policy.

## License

MIT. See [LICENSE](LICENSE).

## Rollback

Disable or uninstall the Tampermonkey script. No Orca runtime, repository, server configuration, or network headers are modified.
