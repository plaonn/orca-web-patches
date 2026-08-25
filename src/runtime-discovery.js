((OWP) => {
  'use strict';

  const BRIDGE_CHANNEL = 'orca-web-patches.runtime.v1';
  const BRIDGE_PING_TIMEOUT_MS = 1_500;
  let bridgeReadyPromise = null;

  function sleep(windowObject, milliseconds) {
    return new Promise((resolve) => windowObject.setTimeout(resolve, milliseconds));
  }

  async function waitForOrcaWebClient(windowObject, timeoutMs = OWP.constants.API_WAIT_TIMEOUT_MS) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      if (windowObject?.__ORCA_WEB_CLIENT__ === true) return true;
      await sleep(windowObject, OWP.constants.API_POLL_INTERVAL_MS);
    }
    return false;
  }

  function pageBridgeBootstrap() {
    'use strict';

    const CHANNEL = 'orca-web-patches.runtime.v1';
    const MARKER = '__orcaWebPatchesRuntimeBridgeV1';

    if (window[MARKER] === true) return;
    try {
      Object.defineProperty(window, MARKER, { value: true, configurable: true });
    } catch {
      window[MARKER] = true;
    }

    function respond(requestId, payload) {
      window.postMessage({
        channel: CHANNEL,
        type: 'response',
        requestId,
        payload
      }, '*');
    }

    window.addEventListener('message', async (event) => {
      if (event.source && event.source !== window) return;
      const message = event.data;
      if (!message || message.channel !== CHANNEL || message.type !== 'request') return;
      if (typeof message.requestId !== 'string' || !message.requestId) return;

      if (message.action === 'ping') {
        respond(message.requestId, { ok: true, kind: 'ready' });
        return;
      }

      if (message.action !== 'discover') return;
      const selector = message.selector;
      if (typeof selector !== 'string' || !selector) {
        respond(message.requestId, {
          ok: false,
          reason: 'runtime-environment-invalid',
          stage: 'environment'
        });
        return;
      }

      const api = window.api?.runtimeEnvironments;
      if (!api?.getStatus || !api?.call) {
        respond(message.requestId, {
          ok: false,
          reason: 'runtime-api-unavailable',
          stage: 'api'
        });
        return;
      }

      let statusEnvelope;
      try {
        statusEnvelope = await api.getStatus({
          selector,
          timeoutMs: message.timeoutMs
        });
      } catch {
        respond(message.requestId, {
          ok: false,
          reason: 'runtime-status-failed',
          stage: 'status'
        });
        return;
      }

      const status = statusEnvelope?.ok === true
        && statusEnvelope.result
        && typeof statusEnvelope.result === 'object'
        ? statusEnvelope.result
        : null;
      if (!status) {
        respond(message.requestId, {
          ok: false,
          reason: 'runtime-status-rejected',
          stage: 'status'
        });
        return;
      }

      const runtimeId = typeof status.runtimeId === 'string' && status.runtimeId
        ? status.runtimeId
        : typeof statusEnvelope?._meta?.runtimeId === 'string'
          ? statusEnvelope._meta.runtimeId
          : null;
      if (!runtimeId) {
        respond(message.requestId, {
          ok: false,
          reason: 'runtime-id-missing',
          stage: 'status'
        });
        return;
      }

      let platform = typeof status.hostPlatform === 'string' && status.hostPlatform
        ? status.hostPlatform
        : null;
      if (!platform) {
        let platformEnvelope;
        try {
          platformEnvelope = await api.call({
            selector,
            method: 'host.platform',
            timeoutMs: message.timeoutMs
          });
        } catch {
          respond(message.requestId, {
            ok: false,
            reason: 'host-platform-call-failed',
            stage: 'platform'
          });
          return;
        }
        platform = platformEnvelope?.ok === true
          ? platformEnvelope.result?.platform
          : null;
      }

      respond(message.requestId, {
        ok: true,
        runtimeId,
        platform,
        appVersion: typeof status.appVersion === 'string' && status.appVersion.trim()
          ? status.appVersion.trim()
          : null
      });
    });
  }

  function installPageBridge(windowObject) {
    const documentObject = windowObject?.document;
    const target = documentObject?.documentElement ?? documentObject?.head ?? documentObject?.body;
    if (!documentObject?.createElement || !target?.appendChild) return false;

    const script = documentObject.createElement('script');
    script.textContent = `(${pageBridgeBootstrap.toString()})();`;
    try {
      target.appendChild(script);
      script.remove?.();
      return true;
    } catch {
      return false;
    }
  }

  function createRequestId() {
    return `owp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function sendBridgeRequest(windowObject, request, timeoutMs) {
    return new Promise((resolve) => {
      const requestId = createRequestId();
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        windowObject.removeEventListener?.('message', onMessage);
        windowObject.clearTimeout?.(timer);
        resolve(value);
      };

      const onMessage = (event) => {
        if (event.source && event.source !== windowObject) return;
        const message = event.data;
        if (!message || message.channel !== BRIDGE_CHANNEL || message.type !== 'response') return;
        if (message.requestId !== requestId) return;
        finish(message.payload);
      };

      windowObject.addEventListener?.('message', onMessage);
      const timer = windowObject.setTimeout(() => {
        finish({ ok: false, reason: 'runtime-page-bridge-timeout', stage: 'bridge' });
      }, timeoutMs);

      try {
        windowObject.postMessage({
          channel: BRIDGE_CHANNEL,
          type: 'request',
          requestId,
          ...request
        }, '*');
      } catch {
        finish({ ok: false, reason: 'runtime-page-bridge-post-failed', stage: 'bridge' });
      }
    });
  }

  async function ensurePageBridge(windowObject) {
    if (bridgeReadyPromise) return bridgeReadyPromise;
    bridgeReadyPromise = (async () => {
      if (!installPageBridge(windowObject)) return false;
      const ping = await sendBridgeRequest(
        windowObject,
        { action: 'ping' },
        BRIDGE_PING_TIMEOUT_MS
      );
      return ping?.ok === true && ping.kind === 'ready';
    })();

    const ready = await bridgeReadyPromise;
    if (!ready) bridgeReadyPromise = null;
    return ready;
  }

  async function discoverRuntime(windowObject, expectedEnvironment) {
    const selector = expectedEnvironment?.environmentId;
    if (typeof selector !== 'string' || !selector) {
      return { ok: false, reason: 'runtime-environment-invalid', stage: 'environment' };
    }

    const ready = await waitForOrcaWebClient(windowObject);
    if (!ready) return { ok: false, reason: 'runtime-api-unavailable', stage: 'api' };

    const bridgeReady = await ensurePageBridge(windowObject);
    if (!bridgeReady) {
      return { ok: false, reason: 'runtime-page-bridge-unavailable', stage: 'bridge' };
    }

    const result = await sendBridgeRequest(
      windowObject,
      {
        action: 'discover',
        selector,
        timeoutMs: OWP.constants.RUNTIME_CALL_TIMEOUT_MS
      },
      (OWP.constants.RUNTIME_CALL_TIMEOUT_MS * 2) + 2_000
    );

    if (!result?.ok) return result ?? {
      ok: false,
      reason: 'runtime-page-bridge-invalid-response',
      stage: 'bridge'
    };

    if (!OWP.runtimeProfile.isValidPlatform(result.platform)) {
      return { ok: false, reason: 'host-platform-invalid', stage: 'platform' };
    }

    return {
      ok: true,
      runtimeId: result.runtimeId,
      platform: result.platform,
      appVersion: result.appVersion,
      transport: 'page-bridge'
    };
  }

  OWP.runtimeDiscovery = Object.freeze({
    waitForOrcaWebClient,
    installPageBridge,
    sendBridgeRequest,
    ensurePageBridge,
    discoverRuntime
  });
})(globalThis.__OWP__);
