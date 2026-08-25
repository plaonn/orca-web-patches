import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.mjs';

const OWP = loadModules(['src/patches/force-linux-platform.js']);

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
      async getHighEntropyValues() { return { platform: 'Windows', platformVersion: '19.0.0', architecture: 'x86' }; },
      toJSON() { return { platform: 'Windows', brands: this.brands }; }
    }
  });
  return navigator;
}

test('Linux spoof preserves Edge browser identity while replacing OS identity', async () => {
  const navigator = makeNavigator();
  const result = OWP.forceLinuxPlatform.applyForceLinuxPlatform(navigator);
  assert.equal(result.applied, true);
  assert.equal(navigator.platform, 'Linux x86_64');
  assert.match(navigator.userAgent, /\(X11; Linux x86_64\)/);
  assert.match(navigator.userAgent, /Edg\/151\.0\.0\.0/);
  assert.doesNotMatch(navigator.userAgent, /Windows NT/);
  assert.equal(navigator.userAgentData.platform, 'Linux');
  assert.equal((await navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion'])).platform, 'Linux');
  assert.equal((await navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion'])).platformVersion, '0.0.0');
  assert.equal(navigator.userAgentData.toJSON().platform, 'Linux');
});
