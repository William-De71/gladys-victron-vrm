import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig,
  DEFAULT_POLL_SECONDS,
  DEFAULT_LOW_LEVEL,
  DEFAULT_OFFLINE_MINUTES,
  AUTO_LANGUAGE,
} from '../src/config.js';

test('defaults: 5 minutes, 20 %, 1 hour, automatic language', () => {
  assert.deepEqual(normalizeConfig(), {
    token: '',
    pollSeconds: DEFAULT_POLL_SECONDS,
    lowLevel: DEFAULT_LOW_LEVEL,
    offlineMinutes: DEFAULT_OFFLINE_MINUTES,
    language: AUTO_LANGUAGE,
  });
  assert.deepEqual(
    [DEFAULT_POLL_SECONDS, DEFAULT_LOW_LEVEL, DEFAULT_OFFLINE_MINUTES],
    [300, 20, 60],
  );
  assert.equal(normalizeConfig(null).token, '');
});

test('the values of the selects, anything else falls back to the default', () => {
  const config = normalizeConfig({
    access_token: 'Token abc\n',
    poll_interval: '900',
    battery_low_level: 30,
    offline_after: '240',
    language: 'de',
  });
  assert.deepEqual(config, {
    token: 'abc',
    pollSeconds: 900,
    lowLevel: 30,
    offlineMinutes: 240,
    language: 'de',
  });
  const odd = normalizeConfig({
    poll_interval: '5',
    battery_low_level: '3',
    offline_after: 'x',
    language: 'it',
  });
  assert.deepEqual(
    [odd.pollSeconds, odd.lowLevel, odd.offlineMinutes, odd.language],
    [300, 20, 60, 'auto'],
  );
});
