import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.mjs';

const OWP = loadModules(['src/patches/align-browser-platform-to-runtime.js']);

function makeNavigator() {
  class FakeNavigator {}
  const navigator = new FakeNavigator();
  Object.assign(navigator, {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0',
    appVersion: '5.0 (Windows NT 10.0; Win64; x64)',
    userAgentData: {
      platform: 'Windows',
      brands: [{ brand: 'Microsoft Edge', version: '151' }],
      async getHighEntropyValues() {
        return { platform: 'Windows', platformVersion: '19.0.0', architecture: 'x86' };
      },
      toJSON() { return { platform: 'Windows', brands: this.brands }; }
    }
  });
  return navigator;
}

test('aligns an affected Windows browser identity to a verified Linux runtime', async () => {
  const navigator = makeNavigator();
  const result = OWP.alignBrowserPlatformToRuntime.applyAlignBrowserPlatformToRuntime(navigator, 'linux');
  assert.equal(result.applied, true);
  assert.equal(result.reason, 'aligned');
  assert.equal(navigator.platform, 'Linux x86_64');
  assert.match(navigator.userAgent, /\(X11; Linux x86_64\)/);
  assert.match(navigator.userAgent, /Edg\/151\.0\.0\.0/);
  assert.doesNotMatch(navigator.userAgent, /Windows NT/);
  assert.equal(navigator.userAgentData.platform, 'Linux');
  assert.equal((await navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion'])).platform, 'Linux');
  assert.equal((await navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion'])).platformVersion, '0.0.0');
  assert.equal(navigator.userAgentData.toJSON().platform, 'Linux');
});

test('aligns an affected Windows browser identity to a verified macOS runtime', async () => {
  const navigator = makeNavigator();
  const result = OWP.alignBrowserPlatformToRuntime.applyAlignBrowserPlatformToRuntime(navigator, 'darwin');
  assert.equal(result.applied, true);
  assert.equal(result.reason, 'aligned');
  assert.equal(navigator.platform, 'MacIntel');
  assert.match(navigator.userAgent, /\(Macintosh; Intel Mac OS X 10_15_7\)/);
  assert.match(navigator.userAgent, /Edg\/151\.0\.0\.0/);
  assert.doesNotMatch(navigator.userAgent, /Windows NT/);
  assert.equal(navigator.userAgentData.platform, 'macOS');
  assert.equal((await navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion'])).platform, 'macOS');
  assert.equal((await navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion'])).platformVersion, '0.0.0');
  assert.equal(navigator.userAgentData.toJSON().platform, 'macOS');
});

test('unsupported runtime identities fail closed instead of inventing a browser identity', () => {
  const navigator = makeNavigator();
  const result = OWP.alignBrowserPlatformToRuntime.applyAlignBrowserPlatformToRuntime(navigator, 'freebsd');
  assert.equal(result.applied, false);
  assert.equal(result.reason, 'unsupported-runtime-platform');
  assert.equal(navigator.platform, 'Win32');
  assert.match(navigator.userAgent, /Windows NT/);
});
