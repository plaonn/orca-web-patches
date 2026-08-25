import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, memoryStorage } from './helpers.mjs';

const OWP = loadModules(['src/constants.js', 'src/runtime-profile.js']);
const env = {
  id: 'web-synthetic',
  preferredEndpointId: 'endpoint-a',
  endpoints: [{ id: 'endpoint-a', endpoint: 'ws://example.invalid/socket', publicKeyB64: 'synthetic-public-key' }]
};

test('current Orca environment identity contains no device token', () => {
  const storage = memoryStorage({
    [OWP.constants.ORCA_ENVIRONMENT_STORAGE_KEY]: JSON.stringify({ ...env, endpoints: [{ ...env.endpoints[0], deviceToken: 'synthetic' }] })
  });
  assert.equal(
    JSON.stringify(OWP.runtimeProfile.readCurrentEnvironment(storage)),
    JSON.stringify({
      environmentId: 'web-synthetic',
      endpoint: 'ws://example.invalid/socket',
      publicKeyB64: 'synthetic-public-key'
    })
  );
});

test('fresh cache is identity-bound and stale cache is rejected', () => {
  const storage = memoryStorage({ [OWP.constants.ORCA_ENVIRONMENT_STORAGE_KEY]: JSON.stringify(env) });
  const identity = OWP.runtimeProfile.readCurrentEnvironment(storage);
  const now = 10_000_000;
  OWP.runtimeProfile.writeProfile(storage, identity, {
    runtimeId: 'runtime-a', platform: 'linux', appVersion: '1.4.188'
  }, now);
  assert.equal(OWP.runtimeProfile.readFreshMatchingProfile(storage, identity, now + 1_000).platform, 'linux');
  assert.equal(OWP.runtimeProfile.readFreshMatchingProfile(storage, { ...identity, endpoint: 'ws://changed.invalid/' }, now + 1_000), null);
  assert.equal(OWP.runtimeProfile.readFreshMatchingProfile(storage, identity, now + OWP.constants.CACHE_TTL_MS + 1), null);
});

test('invalid/conflicting profile data fails closed', () => {
  const storage = memoryStorage({
    [OWP.constants.PROFILE_STORAGE_KEY]: JSON.stringify({ schemaVersion: 1, platform: 'Linux' })
  });
  assert.equal(OWP.runtimeProfile.readProfile(storage), null);
});
