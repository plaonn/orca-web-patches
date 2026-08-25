((OWP) => {
  'use strict';

  const TARGET_IDENTITIES = Object.freeze({
    linux: Object.freeze({
      navigatorPlatform: 'Linux x86_64',
      userAgentPlatform: 'X11; Linux x86_64',
      userAgentDataPlatform: 'Linux',
      platformVersion: '0.0.0'
    })
  });

  function defineNavigatorValue(navigatorObject, name, value) {
    const descriptor = { get: () => value, configurable: true };
    const prototype = Object.getPrototypeOf(navigatorObject);
    try {
      Object.defineProperty(prototype, name, descriptor);
      if (navigatorObject[name] === value) return true;
    } catch {
      // Fall through to an own-property override for unusual browser/test shapes.
    }
    try {
      Object.defineProperty(navigatorObject, name, descriptor);
      return navigatorObject[name] === value;
    } catch {
      return false;
    }
  }

  function rewritePlatformTuple(value, targetIdentity) {
    if (typeof value !== 'string' || !targetIdentity) return value;
    const knownPlatformTuple = /\((?:Windows NT [^)]+|X11; Linux [^)]+|Macintosh; Intel Mac OS X [^)]+)\)/;
    return knownPlatformTuple.test(value)
      ? value.replace(knownPlatformTuple, `(${targetIdentity.userAgentPlatform})`)
      : value;
  }

  function createAlignedUserAgentData(original, targetIdentity) {
    if (!original || typeof original !== 'object' || !targetIdentity) return original;
    return new Proxy(original, {
      get(target, property) {
        if (property === 'platform') return targetIdentity.userAgentDataPlatform;
        if (property === 'getHighEntropyValues') {
          return async (hints = []) => {
            const originalMethod = Reflect.get(target, property, target);
            const result = typeof originalMethod === 'function'
              ? await originalMethod.call(target, hints)
              : {};
            const next = { ...result };
            if (hints.includes('platform')) next.platform = targetIdentity.userAgentDataPlatform;
            if (hints.includes('platformVersion')) next.platformVersion = targetIdentity.platformVersion;
            return next;
          };
        }
        if (property === 'toJSON') {
          return () => {
            const method = Reflect.get(target, property, target);
            const result = typeof method === 'function' ? method.call(target) : {};
            return { ...result, platform: targetIdentity.userAgentDataPlatform };
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  }

  function applyAlignBrowserPlatformToRuntime(
    navigatorObject = globalThis.navigator,
    runtimePlatform
  ) {
    if (!navigatorObject) return { applied: false, fields: [], reason: 'navigator-unavailable' };
    const targetIdentity = TARGET_IDENTITIES[runtimePlatform] ?? null;
    if (!targetIdentity) {
      return { applied: false, fields: [], reason: 'unsupported-runtime-platform' };
    }

    const fields = [];
    const userAgent = rewritePlatformTuple(navigatorObject.userAgent, targetIdentity);
    const appVersion = rewritePlatformTuple(navigatorObject.appVersion, targetIdentity);

    if (defineNavigatorValue(navigatorObject, 'platform', targetIdentity.navigatorPlatform)) {
      fields.push('platform');
    }
    if (typeof userAgent === 'string' && defineNavigatorValue(navigatorObject, 'userAgent', userAgent)) {
      fields.push('userAgent');
    }
    if (typeof appVersion === 'string' && defineNavigatorValue(navigatorObject, 'appVersion', appVersion)) {
      fields.push('appVersion');
    }
    if (navigatorObject.userAgentData) {
      const proxy = createAlignedUserAgentData(navigatorObject.userAgentData, targetIdentity);
      if (defineNavigatorValue(navigatorObject, 'userAgentData', proxy)) fields.push('userAgentData');
    }

    return {
      applied: fields.length > 0,
      fields,
      reason: fields.length > 0 ? 'aligned' : 'no-fields-aligned'
    };
  }

  OWP.alignBrowserPlatformToRuntime = Object.freeze({
    TARGET_IDENTITIES,
    rewritePlatformTuple,
    createAlignedUserAgentData,
    applyAlignBrowserPlatformToRuntime
  });
})(globalThis.__OWP__);
