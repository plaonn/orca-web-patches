((OWP) => {
  'use strict';

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

  function linuxUserAgent(userAgent) {
    if (typeof userAgent !== 'string') return userAgent;
    if (/\(Windows NT [^)]+\)/.test(userAgent)) {
      return userAgent.replace(/\(Windows NT [^)]+\)/, '(X11; Linux x86_64)');
    }
    return userAgent;
  }

  function linuxAppVersion(appVersion) {
    if (typeof appVersion !== 'string') return appVersion;
    return appVersion.replace(/Windows NT [^;)]+(?:; Win64; x64)?/g, 'X11; Linux x86_64');
  }

  function createLinuxUserAgentData(original) {
    if (!original || typeof original !== 'object') return original;
    return new Proxy(original, {
      get(target, property) {
        if (property === 'platform') return 'Linux';
        if (property === 'getHighEntropyValues') {
          return async (hints = []) => {
            const originalMethod = Reflect.get(target, property, target);
            const result = typeof originalMethod === 'function'
              ? await originalMethod.call(target, hints)
              : {};
            const next = { ...result };
            if (hints.includes('platform')) next.platform = 'Linux';
            if (hints.includes('platformVersion')) next.platformVersion = '0.0.0';
            return next;
          };
        }
        if (property === 'toJSON') {
          return () => {
            const method = Reflect.get(target, property, target);
            const result = typeof method === 'function' ? method.call(target) : {};
            return { ...result, platform: 'Linux' };
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  }

  function applyForceLinuxPlatform(navigatorObject = globalThis.navigator) {
    if (!navigatorObject) return { applied: false, fields: [] };
    const fields = [];
    const userAgent = linuxUserAgent(navigatorObject.userAgent);
    const appVersion = linuxAppVersion(navigatorObject.appVersion);

    if (defineNavigatorValue(navigatorObject, 'platform', 'Linux x86_64')) fields.push('platform');
    if (typeof userAgent === 'string' && defineNavigatorValue(navigatorObject, 'userAgent', userAgent)) {
      fields.push('userAgent');
    }
    if (typeof appVersion === 'string' && defineNavigatorValue(navigatorObject, 'appVersion', appVersion)) {
      fields.push('appVersion');
    }
    if (navigatorObject.userAgentData) {
      const proxy = createLinuxUserAgentData(navigatorObject.userAgentData);
      if (defineNavigatorValue(navigatorObject, 'userAgentData', proxy)) fields.push('userAgentData');
    }
    return { applied: fields.length > 0, fields };
  }

  OWP.forceLinuxPlatform = Object.freeze({
    linuxUserAgent,
    linuxAppVersion,
    createLinuxUserAgentData,
    applyForceLinuxPlatform
  });
})(globalThis.__OWP__);
