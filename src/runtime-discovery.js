((OWP) => {
  'use strict';

  function sleep(windowObject, milliseconds) {
    return new Promise((resolve) => windowObject.setTimeout(resolve, milliseconds));
  }

  async function waitForRuntimeApi(windowObject, timeoutMs = OWP.constants.API_WAIT_TIMEOUT_MS) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      const api = windowObject?.api?.runtimeEnvironments;
      if (api?.list && api?.getStatus && api?.call) return api;
      await sleep(windowObject, OWP.constants.API_POLL_INTERVAL_MS);
    }
    return null;
  }

  function unwrapEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object' || envelope.ok !== true) return null;
    return envelope.result && typeof envelope.result === 'object' ? envelope.result : null;
  }

  async function discoverRuntime(windowObject, expectedEnvironment) {
    const api = await waitForRuntimeApi(windowObject);
    if (!api) return { ok: false, reason: 'runtime-api-unavailable' };

    let environments;
    try {
      environments = await api.list();
    } catch {
      return { ok: false, reason: 'runtime-environment-list-failed' };
    }
    const environment = Array.isArray(environments)
      ? environments.find((entry) => entry?.id === expectedEnvironment?.environmentId)
      : null;
    if (!environment) return { ok: false, reason: 'runtime-environment-mismatch' };

    let statusEnvelope;
    try {
      statusEnvelope = await api.getStatus({
        selector: environment.id,
        timeoutMs: OWP.constants.RUNTIME_CALL_TIMEOUT_MS
      });
    } catch {
      return { ok: false, reason: 'runtime-status-failed' };
    }
    const status = unwrapEnvelope(statusEnvelope);
    if (!status) return { ok: false, reason: 'runtime-status-rejected' };

    const runtimeId = typeof status.runtimeId === 'string' && status.runtimeId
      ? status.runtimeId
      : typeof statusEnvelope?._meta?.runtimeId === 'string'
        ? statusEnvelope._meta.runtimeId
        : null;
    if (!runtimeId) return { ok: false, reason: 'runtime-id-missing' };

    let platform = OWP.runtimeProfile.isValidPlatform(status.hostPlatform)
      ? status.hostPlatform
      : null;
    if (!platform) {
      let platformEnvelope;
      try {
        platformEnvelope = await api.call({
          selector: environment.id,
          method: 'host.platform',
          timeoutMs: OWP.constants.RUNTIME_CALL_TIMEOUT_MS
        });
      } catch {
        return { ok: false, reason: 'host-platform-call-failed' };
      }
      const platformResult = unwrapEnvelope(platformEnvelope);
      platform = platformResult?.platform;
    }
    if (!OWP.runtimeProfile.isValidPlatform(platform)) {
      return { ok: false, reason: 'host-platform-invalid' };
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
