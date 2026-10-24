// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`), which checks the discovered
// devices, the states and the scene events like the host API does, and a fake
// VRM (test/helpers/fake-vrm.js), a real HTTP server on 127.0.0.1. No test
// touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, ACTIONS, USER_AGENT, ACCESS_RETRY_MS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import { TRIGGERS, SCENE_ACTIONS, TODAY_OUTPUTS, FORECAST_OUTPUTS } from '../src/events.js';
import { FILE } from '../src/store.js';
import {
  startFakeVrm,
  dataDir,
  silent,
  NOW,
  TZ,
  TOKEN,
  USER_ID,
  MINUTE,
  HOUR,
  HOME,
  BOAT,
} from './helpers/fake-vrm.js';

const CONFIG = { access_token: TOKEN, language: 'en' };
const PREFIX = 'ext:test-integration';
const HOME_ID = `${PREFIX}:site:${HOME}`;
const BOAT_ID = `${PREFIX}:site:${BOAT}`;

/**
 * @description The integration, connected to a fake Gladys and a fake VRM.
 * @param {object} t - The test context (closes everything after).
 * @param {object} [options] - `{ config, dir, clock, fake }`.
 * @returns {Promise<object>} `{ gladys, app, fake, clock, dir }`.
 */
async function startApp(t, { config = CONFIG, dir = dataDir(), clock = { now: NOW }, fake } = {}) {
  fake ??= await startFakeVrm({ now: () => clock.now });
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, {
    baseUrl: fake.url,
    dataDir: dir,
    now: () => clock.now,
    timeZone: TZ,
    timers: false,
    spacingMs: 0,
    logger: silent,
  });
  await gladys.connect();
  await app.whenReady();
  t.after(async () => {
    await gladys.fake.shutdown().catch(() => {});
    await fake.close();
  });
  return { gladys, app, fake, clock, dir };
}

/**
 * @description Create every offered device, like the user would.
 * @param {object} gladys - The fake Gladys.
 */
async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(structuredClone(device));
  }
}
const paths = (fake, from = 0) =>
  fake.calls
    .slice(from)
    .map((call) => `${call.path}${call.query.type ? `:${call.query.type}` : ''}`);
const events = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);

test('startup: the user, every installation in one request, then each one; devices offered', async (t) => {
  const { gladys, app, fake } = await startApp(t);
  assert.deepEqual(fake.calls, [], 'no request before the timer');
  await app.tick();
  assert.deepEqual(paths(fake), [
    'users/me',
    `users/${USER_ID}/installations`,
    `installations/${HOME}/stats:kwh`,
    `installations/${HOME}/alarm-log`,
    `installations/${HOME}/stats:forecast`,
    `installations/${BOAT}/stats:kwh`,
    `installations/${BOAT}/alarm-log`,
    `installations/${BOAT}/stats:forecast`,
  ]);
  for (const call of fake.calls) {
    assert.equal(call.method, 'GET', 'read only');
    assert.equal(call.auth, `Token ${TOKEN}`);
    assert.equal(call.userAgent, USER_AGENT);
  }
  // The day of the installation, from its local midnight, per hour.
  const kwh = fake.calls[2].query;
  assert.equal(kwh.interval, 'hours');
  assert.equal(Number(kwh.start), Date.parse('2026-10-23T22:00:00Z') / 1000);
  assert.equal(Number(kwh.end), NOW / 1000);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => [
      device.external_id,
      device.name,
      device.features.length,
    ]),
    [
      [HOME_ID, 'Victron Home ESS', 9],
      [BOAT_ID, 'Victron Sailboat', 7],
    ],
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    '2 installation(s): Home ESS 72 %, Sailboat 88 %.',
  );
  await app.tick();
  assert.equal(fake.calls.length, 8, 'nothing more is due');
});

test('the pace: installations at the interval, today every 15 min, forecast every hour', async (t) => {
  const { app, fake, clock } = await startApp(t);
  await app.tick();
  clock.now += 5 * MINUTE;
  await app.tick();
  assert.deepEqual(paths(fake, 8), [`users/${USER_ID}/installations`]);
  clock.now += 10 * MINUTE;
  await app.tick();
  assert.deepEqual(paths(fake, 9), [
    `users/${USER_ID}/installations`,
    `installations/${HOME}/stats:kwh`,
    `installations/${BOAT}/stats:kwh`,
  ]);
  clock.now += 45 * MINUTE;
  await app.tick();
  assert.deepEqual(paths(fake, 12), [
    `users/${USER_ID}/installations`,
    `installations/${HOME}/stats:kwh`,
    `installations/${HOME}/alarm-log`,
    `installations/${HOME}/stats:forecast`,
    `installations/${BOAT}/stats:kwh`,
    `installations/${BOAT}/alarm-log`,
  ]);
  // No forecast for the boat: asked again after 6 hours only.
  assert.ok(app.dueOf(BOAT).every((task) => task !== 'forecast'));
});

test('a restart does not read everything again: the times are kept in /data', async (t) => {
  const dir = dataDir();
  const clock = { now: NOW };
  const first = await startApp(t, { dir, clock });
  await first.app.tick();
  const saved = JSON.parse(readFileSync(join(dir, FILE), 'utf8'));
  assert.equal(saved.userId, USER_ID);
  assert.ok(!JSON.stringify(saved).includes(TOKEN), 'never the token');
  clock.now += MINUTE;
  const second = await startApp(t, { dir, clock });
  await second.app.tick();
  assert.equal(second.fake.calls.length, 0);
  assert.equal(second.gladys.fake.discoveredDevices.length, 2, 'offered from /data at once');
});

test('states: published once the device exists, all again on creation; battery power split', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  assert.equal(gladys.fake.states.length, 0, 'no state before the devices exist');
  await createAll(gladys);
  const state = (key, device = HOME_ID) => gladys.fake.lastState(`${device}:${key}`);
  assert.equal(state('battery_level'), 72);
  assert.equal(state('battery_voltage'), 52.4);
  assert.equal(state('battery_discharge_power'), 445, '52.4 V × 8.5 A');
  assert.equal(state('battery_charge_power'), 0);
  assert.equal(state('pv_power'), 1850);
  assert.equal(state('grid_power'), -210, 'export is negative');
  assert.equal(state('load_power'), 640);
  assert.ok(state('pv_today') > 0);
  assert.ok(state('load_today') > 0);
  assert.equal(state('generator_power'), undefined, 'no generator feature');
  assert.equal(state('battery_charge_power', BOAT_ID), 56, '13.31 V × 4.2 A');
  assert.equal(state('pv_power', BOAT_ID), undefined, 'no solar on the boat');
  // Only what changed is published again.
  const before = gladys.fake.states.length;
  clock.now += 5 * MINUTE;
  await app.tick();
  assert.equal(gladys.fake.states.length, before, 'same values: nothing published');
  Object.assign(fake.sites[HOME].values, { from_to_grid: 2500, bc: 3, solar_yield: 0 });
  clock.now += 5 * MINUTE;
  await app.tick();
  assert.equal(state('grid_power'), 2500);
  assert.equal(state('battery_charge_power'), 157);
  assert.equal(state('battery_discharge_power'), 0);
  assert.equal(state('pv_power'), 0);
});

test('battery low and full: once per transition, with the level of the configuration', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t, {
    config: { ...CONFIG, battery_low_level: '30' },
  });
  await app.tick();
  for (const soc of [31, 30, 29, 34, 36, 30]) {
    fake.sites[HOME].values.bs = soc;
    clock.now += 5 * MINUTE;
    await app.tick();
  }
  const low = events(gladys, TRIGGERS.BATTERY_LOW);
  assert.equal(low.length, 2);
  assert.deepEqual(low[0].data, {
    installation: HOME_ID,
    installation_name: 'Victron Home ESS',
    site_id: HOME,
    battery_level: 30,
    battery_voltage: 52.4,
    low_level: 30,
  });
  fake.sites[BOAT].values.bs = 100;
  clock.now += 5 * MINUTE;
  await app.tick();
  const full = events(gladys, TRIGGERS.BATTERY_FULL);
  assert.equal(full.length, 1);
  assert.equal(full[0].data.installation, BOAT_ID);
});

test('grid lost and restored from the grid alarm of the installation', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  fake.sites[HOME].values.Agl = 2;
  clock.now += 5 * MINUTE;
  await app.tick();
  assert.equal(events(gladys, TRIGGERS.GRID_LOST).length, 1);
  const live = await gladys.fake.widgetGet(WIDGETS.LIVE, { settings: { installation: HOME_ID } });
  assert.match(JSON.stringify(live.data.content), /lost \(alarm\)/);
  fake.sites[HOME].values.Agl = 0;
  clock.now += 20 * MINUTE;
  await app.tick();
  const restored = events(gladys, TRIGGERS.GRID_RESTORED);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].data.minutes_lost, 20);
});

test('offline: no new data for the delay fires once, the states are no longer published', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  await createAll(gladys);
  // VRM stops receiving data: its last timestamp stays where it was.
  const last = clock.now - 4 * MINUTE;
  fake.sites[HOME].lastAgo = null;
  const freeze = () => {
    fake.sites[HOME].lastAgo = clock.now - last;
  };
  for (let i = 0; i < 13; i += 1) {
    clock.now += 5 * MINUTE;
    freeze();
    await app.tick();
  }
  const offline = events(gladys, TRIGGERS.INSTALLATION_OFFLINE);
  assert.equal(offline.length, 1);
  assert.ok(offline[0].data.minutes_without_data > 60);
  assert.match(gladys.fake.connectionStatus.message.en, /Home ESS offline/);
  const before = gladys.fake.states.filter((s) => s.device_feature_external_id.startsWith(HOME_ID));
  Object.assign(fake.sites[HOME].values, { bs: 10 });
  clock.now += 5 * MINUTE;
  freeze();
  await app.tick();
  assert.equal(
    gladys.fake.states.filter((s) => s.device_feature_external_id.startsWith(HOME_ID)).length,
    before.length,
    'stale values are not published',
  );
  assert.equal(events(gladys, TRIGGERS.BATTERY_LOW).length, 0, 'no trigger on stale data');
  const live = await gladys.fake.widgetGet(WIDGETS.LIVE, { settings: { installation: HOME_ID } });
  assert.match(JSON.stringify(live.data.content), /has not received any data/);
  fake.sites[HOME].lastAgo = MINUTE;
  clock.now += 5 * MINUTE;
  await app.tick();
  assert.equal(events(gladys, TRIGGERS.INSTALLATION_ONLINE).length, 1);
});

test('alarms: an alarm change in VRM reads the log at once; raised then cleared', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  const started = clock.now + 2 * MINUTE;
  fake.alarms[HOME] = [
    fake.alarmRecord({ id: 77, description: 'Low battery', device: 'Multi', started }),
  ];
  Object.assign(fake.sites[HOME], { alarm: true, num_alarms: 1, current_alarms: ['Low battery'] });
  clock.now += 5 * MINUTE;
  await app.tick();
  assert.ok(paths(fake).includes(`installations/${HOME}/alarm-log`));
  const raised = events(gladys, TRIGGERS.ALARM_RAISED);
  assert.equal(raised.length, 1);
  assert.equal(raised[0].data.alarm_id, 77);
  assert.equal(raised[0].data.description, 'Low battery');
  assert.equal(raised[0].data.installation, HOME_ID);
  assert.equal(raised[0].data.duration_minutes, 3);
  const widget = await gladys.fake.widgetGet(WIDGETS.ALARMS, {
    settings: { installation: HOME_ID },
    language: 'fr',
  });
  assert.match(JSON.stringify(widget.data.content), /Low battery/);
  assert.match(JSON.stringify(widget.data.content), /1 active\(s\)/);
  fake.alarms[HOME] = [
    fake.alarmRecord({ id: 77, description: 'Low battery', started, cleared: clock.now }),
  ];
  Object.assign(fake.sites[HOME], { alarm: false, num_alarms: 0, current_alarms: [] });
  clock.now += 5 * MINUTE;
  await app.tick();
  const cleared = events(gladys, TRIGGERS.ALARM_CLEARED);
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0].data.alarm_id, 77);
  assert.ok(cleared[0].data.cleared_at);
});

test('access refused: a wrong token fires once, the status says it, tried again later', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t, {
    config: { ...CONFIG, access_token: 'wrong-token' },
  });
  await app.tick();
  const refused = events(gladys, TRIGGERS.ACCESS_REFUSED);
  assert.equal(refused.length, 1);
  assert.deepEqual([refused[0].data.reason, refused[0].data.code], ['auth', 'invalid_token']);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refuses the access token/);
  clock.now += MINUTE;
  await app.tick();
  assert.equal(fake.calls.length, 1, 'not tried again at once');
  clock.now += ACCESS_RETRY_MS;
  await app.tick();
  assert.equal(fake.calls.length, 2);
  assert.equal(events(gladys, TRIGGERS.ACCESS_REFUSED).length, 1, 'once per refusal');
  // The right token: read at once.
  await gladys.fake.configUpdated(CONFIG);
  await app.tick();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('access refused: a 403 on the installations of the account fires "forbidden" once', async (t) => {
  const { gladys, app, fake } = await startApp(t);
  fake.refuse(`users/${USER_ID}/installations`, 403, { code: 'forbidden', times: 5 });
  await app.tick();
  const refused = events(gladys, TRIGGERS.ACCESS_REFUSED);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].data.reason, 'forbidden');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refuses this request/);
  assert.equal(fake.calls.length, 2, 'users/me, then the installations, nothing more');
});

test('no token: no request, the status and the widgets ask for it', async (t) => {
  const { gladys, app, fake } = await startApp(t, { config: { language: 'fr' } });
  await app.tick();
  assert.equal(fake.calls.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /jeton d’accès VRM/);
  const widget = await gladys.fake.widgetGet(WIDGETS.LIVE, { language: 'de' });
  assert.match(JSON.stringify(widget.data.content), /Zugriffstoken/);
});

test('429: the readings stop and wait for Retry-After, the status says it', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  fake.refuse(`installations/${HOME}/alarm-log`, 429, { headers: { 'retry-after': '300' } });
  await app.tick();
  assert.deepEqual(paths(fake), [
    'users/me',
    `users/${USER_ID}/installations`,
    `installations/${HOME}/stats:kwh`,
    `installations/${HOME}/alarm-log`,
  ]);
  assert.match(gladys.fake.connectionStatus.message.en, /slow down/);
  clock.now += 2 * MINUTE;
  await app.tick();
  assert.equal(fake.calls.length, 4, 'paused');
  clock.now += 4 * MINUTE;
  await app.tick();
  assert.ok(fake.calls.length > 4);
  assert.ok(paths(fake, 4).includes(`installations/${HOME}/alarm-log`));
});

test('a refused alarm log or forecast (403) is asked again a day later only', async (t) => {
  const { app, fake, clock } = await startApp(t);
  fake.refuse(`installations/${BOAT}/alarm-log`, 403, { code: 'forbidden' });
  await app.tick();
  const view = app.viewOf(BOAT);
  assert.equal(view.alarmsRefused, true);
  clock.now += 2 * HOUR;
  await app.tick();
  assert.ok(!paths(fake, 8).includes(`installations/${BOAT}/alarm-log`));
  clock.now += 23 * HOUR;
  await app.tick();
  assert.ok(paths(fake, 8).includes(`installations/${BOAT}/alarm-log`));
});

test('VRM unreachable for a while: tried again in a few minutes, nothing lost', async (t) => {
  const { app, fake, clock } = await startApp(t);
  fake.refuse(`installations/${HOME}/stats`, 503, { times: 1 });
  await app.tick();
  assert.equal(app.viewOf(HOME).today, null);
  clock.now += 6 * MINUTE;
  await app.tick();
  assert.ok(app.viewOf(HOME).today?.totals);
});

test('widgets: the four, for the installation chosen or the first, in the language asked', async (t) => {
  const { gladys, app } = await startApp(t);
  await app.tick();
  for (const key of Object.values(WIDGETS)) {
    for (const installation of [HOME_ID, BOAT_ID, undefined]) {
      const result = await gladys.fake.widgetGet(key, {
        settings: { installation },
        language: 'es',
      });
      assert.equal(result.success, true, key);
      assert.deepEqual(validateWidgetContent(result.data.content), [], key);
    }
  }
  const today = await gladys.fake.widgetGet(WIDGETS.TODAY, { language: 'de' });
  assert.match(JSON.stringify(today.data.content), /Victron Home ESS/);
  assert.match(JSON.stringify(today.data.content), /Solar heute/);
  const boat = await gladys.fake.widgetGet(WIDGETS.FORECAST, {
    settings: { installation: BOAT_ID },
  });
  assert.match(JSON.stringify(boat.data.content), /no forecast/);
});

test('scene actions: the energies of today (no request) and the forecast', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  const count = fake.calls.length;
  const today = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_TODAY, {});
  assert.equal(today.success, true);
  assert.deepEqual(
    Object.keys(today.data.outputs).filter((key) => !TODAY_OUTPUTS.includes(key)),
    [],
    'declared outputs only',
  );
  assert.ok(today.data.outputs.solar_kwh > 0);
  assert.equal(today.data.outputs.battery_level, 72);
  assert.match(today.data.outputs.summary, /^Today: solar/);
  assert.equal(fake.calls.length, count, 'no request');
  const forecast = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_FORECAST, {
    installation: HOME_ID,
  });
  assert.equal(forecast.success, true);
  assert.deepEqual(
    Object.keys(forecast.data.outputs).filter((key) => !FORECAST_OUTPUTS.includes(key)),
    [],
  );
  assert.ok(
    forecast.data.outputs.solar_tomorrow_kwh > forecast.data.outputs.solar_today_kwh,
    'sunnier tomorrow',
  );
  assert.ok(forecast.data.outputs.solar_remaining_kwh < forecast.data.outputs.solar_today_kwh);
  assert.equal(fake.calls.length, count, 'the forecast of the timer is recent');
  clock.now += 2 * HOUR;
  await gladys.fake.sceneAction(SCENE_ACTIONS.GET_FORECAST, { installation: HOME_ID });
  assert.deepEqual(paths(fake, count), [`installations/${HOME}/stats:forecast`]);
  const none = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_FORECAST, {
    installation: BOAT_ID,
  });
  assert.equal(none.success, false);
  assert.match(none.error, /no forecast/);
  assert.equal(events(gladys, TRIGGERS.ALARM_RAISED).length, 0);
});

test('configuration buttons: test the connection, diagnostic without the token', async (t) => {
  const logs = [];
  const fake = await startFakeVrm({ now: () => NOW });
  const gladys = createFakeGladys({ config: CONFIG });
  const app = createApp(gladys, {
    baseUrl: fake.url,
    dataDir: dataDir(),
    now: () => NOW,
    timeZone: TZ,
    timers: false,
    spacingMs: 0,
    logger: { ...silent, info: (line) => logs.push(line) },
  });
  t.after(async () => {
    await gladys.fake.shutdown().catch(() => {});
    await fake.close();
  });
  await gladys.connect();
  await app.whenReady();
  const tested = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(tested.data.message.en, /Connected to VRM as Test User: 2 installation\(s\)/);
  assert.match(tested.data.message.fr, /Home ESS \(n° 101, données il y a 4 min\)/);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  const diagnostic = await gladys.fake.action(ACTIONS.DIAGNOSTIC);
  assert.match(diagnostic.data.message.en, /Diagnostic written/);
  const written = logs.filter((line) => line.startsWith('VRM diagnostic')).join('');
  assert.match(written, /"token":"set"/);
  assert.ok(!written.includes(TOKEN));
});

test('a scan offers the devices again', async (t) => {
  const { gladys, app } = await startApp(t);
  await app.tick();
  const offered = gladys.fake.bodies('POST', '/discovered_device').length;
  await gladys.fake.scanRequest();
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, offered + 1);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});
