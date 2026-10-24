// The VRM client against the fake VRM: the token header, the answers, the
// refusals and the pause a 429 asks for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createVrmClient,
  readToken,
  retryAfterSeconds,
  kindOfStatus,
  MIN_PAUSE_MS,
  MAX_PAUSE_MS,
  BASE_URL,
} from '../src/vrm-api.js';
import { startFakeVrm, TOKEN, USER_ID, HOME, NOW, MINUTE } from './helpers/fake-vrm.js';

/**
 * @description A client of the fake VRM.
 * @param {object} t - The test context.
 * @param {object} [options] - `{ token, clock }`.
 * @returns {Promise<object>} `{ api, fake, clock }`.
 */
async function client(t, { token = TOKEN, clock = { now: NOW } } = {}) {
  const fake = await startFakeVrm({ now: () => clock.now });
  t.after(() => fake.close());
  const api = createVrmClient({
    getToken: () => token,
    userAgent: 'test-agent',
    baseUrl: fake.url,
    spacingMs: 0,
    now: () => clock.now,
  });
  return { api, fake, clock };
}

test('the official API root, over HTTPS', () => {
  assert.equal(BASE_URL, 'https://vrmapi.victronenergy.com/v2');
});

test('a token pasted with its prefix or a line break is cut to the token', () => {
  assert.equal(readToken(' Token abc123\n'), 'abc123');
  assert.equal(readToken('Bearer xyz'), 'xyz');
  assert.equal(readToken('abc def'), 'abc');
  assert.equal(readToken(undefined), '');
  assert.equal(readToken(42), '');
});

test('the token travels in x-authorization as "Token <token>", only GET requests', async (t) => {
  const { api, fake } = await client(t);
  const me = await api.me();
  assert.equal(me.user.id, USER_ID);
  const list = await api.installations(USER_ID);
  assert.equal(list.records.length, 2);
  assert.deepEqual(
    fake.calls.map((call) => [call.method, call.path, call.auth, call.userAgent]),
    [
      ['GET', 'users/me', `Token ${TOKEN}`, 'test-agent'],
      ['GET', `users/${USER_ID}/installations`, `Token ${TOKEN}`, 'test-agent'],
    ],
  );
  assert.equal(fake.calls[1].query.extended, '1');
  assert.equal(api.requests(), 2);
});

test('a wrong token: HTTP 401 invalid_token becomes an auth error, without the token', async (t) => {
  const { api } = await client(t, { token: 'wrong-token-value' });
  await assert.rejects(api.me(), (err) => {
    assert.equal(err.kind, 'auth');
    assert.equal(err.status, 401);
    assert.equal(err.code, 'invalid_token');
    assert.doesNotMatch(err.message, /wrong-token-value/);
    return true;
  });
});

test('no token: refused before any request', async (t) => {
  const { api, fake } = await client(t, { token: '' });
  await assert.rejects(api.me(), { kind: 'auth' });
  assert.equal(fake.calls.length, 0);
});

test('an empty alarm log (HTTP 200, success false, no_results_found) is an empty list', async (t) => {
  const { api } = await client(t);
  assert.deepEqual(await api.alarmLog(HOME, 25), { success: true, records: [] });
});

test('stats passes the type, the interval and the bounds in seconds', async (t) => {
  const { api, fake } = await client(t);
  const answer = await api.stats(HOME, { type: 'kwh', interval: 'hours', start: 1, end: 2 });
  assert.equal(answer.success, true);
  assert.deepEqual(fake.calls[0].query, { type: 'kwh', interval: 'hours', start: '1', end: '2' });
});

test('statuses become kinds: 403 forbidden, 404, 5xx server, other http', () => {
  assert.deepEqual([401, 403, 404, 429, 500, 503, 400].map(kindOfStatus), [
    'auth',
    'forbidden',
    'not_found',
    'rate_limit',
    'server',
    'server',
    'http',
  ]);
});

test('a 429 pauses every request for its Retry-After (30 s to 1 h)', async (t) => {
  const { api, fake, clock } = await client(t);
  fake.refuse('users/me', 429, {
    headers: { 'retry-after': '120' },
    body: { success: false, errors: 'Too many requests', error_code: 'rate_limited' },
  });
  await assert.rejects(api.me(), (err) => err.kind === 'rate_limit' && err.retryAfter === 120);
  assert.equal(api.pausedUntil(), NOW + 120 * 1000);
  // Held without a request while paused.
  await assert.rejects(api.installations(USER_ID), { kind: 'rate_limit' });
  assert.equal(fake.calls.length, 1);
  clock.now += 2 * MINUTE;
  assert.equal(api.pausedUntil(), 0);
  await api.me();
  assert.equal(fake.calls.length, 2);
});

test('Retry-After: seconds, an HTTP date, or nothing', () => {
  assert.equal(retryAfterSeconds('15', NOW), 15);
  assert.equal(retryAfterSeconds(new Date(NOW + 90000).toUTCString(), NOW), 90);
  assert.equal(retryAfterSeconds(null, NOW), null);
  assert.equal(retryAfterSeconds('soon', NOW), null);
  assert.ok(MIN_PAUSE_MS === 30000 && MAX_PAUSE_MS === 3600000);
});

test('a 429 without Retry-After still pauses 30 s; a huge one at most an hour', async (t) => {
  const { api, fake, clock } = await client(t);
  fake.refuse('users/me', 429);
  await assert.rejects(api.me(), { kind: 'rate_limit' });
  assert.equal(api.pausedUntil(), NOW + MIN_PAUSE_MS);
  clock.now += MIN_PAUSE_MS;
  fake.refuse('users/me', 429, { headers: { 'retry-after': '999999' } });
  await assert.rejects(api.me(), { kind: 'rate_limit' });
  assert.equal(api.pausedUntil(), clock.now + MAX_PAUSE_MS);
});

test('unreachable and unreadable answers', async () => {
  const down = createVrmClient({
    getToken: () => TOKEN,
    userAgent: 'x',
    spacingMs: 0,
    fetch: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  await assert.rejects(down.me(), { kind: 'unreachable' });
  const html = createVrmClient({
    getToken: () => TOKEN,
    userAgent: 'x',
    spacingMs: 0,
    fetch: async () => new Response('<html>maintenance</html>', { status: 200 }),
  });
  await assert.rejects(html.me(), { kind: 'failed' });
  const refused = createVrmClient({
    getToken: () => TOKEN,
    userAgent: 'x',
    spacingMs: 0,
    fetch: async () =>
      new Response(JSON.stringify({ success: false, errors: 'x', error_code: 'odd' }), {
        status: 200,
      }),
  });
  await assert.rejects(refused.me(), { kind: 'failed', code: 'odd' });
});

test('one request at a time, spaced', async () => {
  const starts = [];
  let clock = 10000;
  const api = createVrmClient({
    getToken: () => TOKEN,
    userAgent: 'x',
    spacingMs: 1000,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetch: async () => {
      starts.push(clock);
      clock += 200;
      return new Response(JSON.stringify({ success: true, user: { id: 1 } }), { status: 200 });
    },
  });
  await Promise.all([api.me(), api.me(), api.me()]);
  assert.deepEqual(starts, [10000, 11200, 12400]);
  assert.equal(api.backlog(), 0);
});
