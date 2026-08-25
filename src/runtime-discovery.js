((OWP) => {
  'use strict';

  function sleep(windowObject, milliseconds) {
    return new Promise((resolve) => windowObject.setTimeout(resolve, milliseconds));
  }

  async function waitForRuntimeApi(windowObject, timeoutMs = OWP.constants.API_WAIT_TIMEOUT_MS) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      const api = windowObject?.api?.runtimeEnvironments;
      if (api?.getStatus && api?.call) return api;
      await sleep(windowObject, OWP.constants.API_POLL_INTERVAL_MS);
    }
    return null;
  }

  function unwrapEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object' || envelope.ok !== true) return null;
    return envelope.result && typeof envelope.result === 'object' ? envelope.result : null;
  }

  async function discoverRuntime(windowObject, expectedEnvironment) {
    const selector = expectedEnvironment?.environmentId;
    if (typeof selector !== 'string' || !selector) {
      return { ok: false, reason: 'runtime-environment-invalid', stage: 'environment' };
    }

    const api = await waitForRuntimeApi(windowObject);
    if (!api) return { ok: false, reason: 'runtime-api-unavailable', stage: 'api' };

    // The persisted environment identity is already the authority for which paired
    // runtime to query. Avoid runtimeEnvironments.list(): in paired browser clients
    // that public listing is unnecessary for identity verification and may cross a
    // userscript/page-world async boundary that never settles.
    let statusEnvelope;
    try {
      statusEnvelope = await api.getStatus({
        selector,
        timeoutMs: OWP.constants.RUNTIME_CALL_TIMEOUT_MS
      });
    } catch {
      return { ok: false, reason: 'runtime-status-failed', stage: 'status' };
    }
    const status = unwrapEnvelope(statusEnvelope);
    if (!status) return { ok: false, reason: 'runtime-status-rejected', stage: 'status' };

    const runtimeId = typeof status.runtimeId === 'string' && status.runtimeId
      ? status.runtimeId
      : typeof statusEnvelope?._meta?.runtimeId === 'string'
        ? statusEnvelope._meta.runtimeId
        : null;
    if (!runtimeId) return { ok: false, reason: 'runtime-id-missing', stage: 'status' };

    let platform = OWP.runtimeProfile.isValidPlatform(status.hostPlatform)
      ? status.hostPlatform
      : null;
    if (!platform) {
      let platformEnvelope;
      try {
        platformEnvelope = await api.call({
          selector,
          method: 'host.platform',
          timeoutMs: OWP.constants.RUNTIME_CALL_TIMEOUT_MS
        });
      } catch {
        return { ok: false, reason: 'host-platform-call-failed', stage: 'platform' };
      }
      const platformResult = unwrapEnvelope(platformEnvelope);
      platform = platformResult?.platform;
    }
    if (!OWP.runtimeProfile.isValidPlatform(platform)) {
      return { ok: false, reason: 'host-platform-invalid', stage: 'platform' };
    }

    const appVersion = typeof status.appVersion === 'string' && status.appVersion.trim()
      ? status.appVersion.trim()
      : null;

    return {
      ok: true,
      runtimeId,
      platform,
      appVersion
    };
  }

  OWP.runtimeDiscovery = Object.freeze({ waitForRuntimeApi, unwrapEnvelope, discoverRuntime });
})(globalThis.__OWP__);
