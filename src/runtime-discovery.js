((OWP) => {
  'use strict';

  function sleep(windowObject, milliseconds) {
    return new Promise((resolve) => windowObject.setTimeout(resolve, milliseconds));
  }

  async function waitForRuntimeApi(windowObject, timeoutMs = OWP.constants.API_WAIT_TIMEOUT_MS) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      const api = windowObject?.api?.runtimeEnvironments;
      if (windowObject?.__ORCA_WEB_CLIENT__ === true && api?.getStatus && api?.call) return api;
      await sleep(windowObject, OWP.constants.API_POLL_INTERVAL_MS);
    }
    return null;
  }

  function createTimeoutError(stage) {
    const error = new Error(`${stage}-timeout`);
    error.code = 'OWP_RUNTIME_CALL_TIMEOUT';
    return error;
  }

  function withTimeout(windowObject, operation, timeoutMs, stage) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = windowObject.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(createTimeoutError(stage));
      }, timeoutMs);

      Promise.resolve()
        .then(operation)
        .then(
          (value) => {
            if (settled) return;
            settled = true;
            windowObject.clearTimeout?.(timer);
            resolve(value);
          },
          (error) => {
            if (settled) return;
            settled = true;
            windowObject.clearTimeout?.(timer);
            reject(error);
          }
        );
    });
  }

  function isTimeoutError(error) {
    return error?.code === 'OWP_RUNTIME_CALL_TIMEOUT';
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

    let statusEnvelope;
    try {
      statusEnvelope = await withTimeout(
        windowObject,
        () => api.getStatus({
          selector,
          timeoutMs: OWP.constants.RUNTIME_CALL_TIMEOUT_MS
        }),
        OWP.constants.RUNTIME_CALL_TIMEOUT_MS + 1_000,
        'runtime-status'
      );
    } catch (error) {
      return {
        ok: false,
        reason: isTimeoutError(error) ? 'runtime-status-timeout' : 'runtime-status-failed',
        stage: 'status'
      };
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
        platformEnvelope = await withTimeout(
          windowObject,
          () => api.call({
            selector,
            method: 'host.platform',
            timeoutMs: OWP.constants.RUNTIME_CALL_TIMEOUT_MS
          }),
          OWP.constants.RUNTIME_CALL_TIMEOUT_MS + 1_000,
          'host-platform'
        );
      } catch (error) {
        return {
          ok: false,
          reason: isTimeoutError(error) ? 'host-platform-timeout' : 'host-platform-call-failed',
          stage: 'platform'
        };
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

  OWP.runtimeDiscovery = Object.freeze({
    waitForRuntimeApi,
    withTimeout,
    unwrapEnvelope,
    discoverRuntime
  });
})(globalThis.__OWP__);
