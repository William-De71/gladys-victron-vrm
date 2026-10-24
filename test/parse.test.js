// The parsers against answers recorded from the live VRM API (public demo
// account, test/fixtures/vrm-demo.json) and against broken ones: a value VRM
// does not give stays null, never 0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toNumber,
  parseMe,
  parseInstallations,
  parseKwh,
  parseForecast,
  parseAlarmLog,
  energiesOf,
  selfSufficiency,
} from '../src/parse.js';

const live = JSON.parse(readFileSync(new URL('./fixtures/vrm-demo.json', import.meta.url), 'utf8'));

test('numbers: finite numbers and numeric strings only', () => {
  assert.deepEqual([49.01, '49.01', '-8.4', '', null, 'v3.85', NaN, true].map(toNumber), [
    49.01,
    49.01,
    -8.4,
    null,
    null,
    null,
    null,
    null,
  ]);
});

test('users/me gives the user id', () => {
  assert.equal(parseMe(live.me), 22);
  assert.equal(parseMe({ success: true, user: {} }), null);
  assert.equal(parseMe(null), null);
});

test('installations?extended=1 (live shape): the values by code, null when VRM has none', () => {
  const [yacht, ess] = parseInstallations(live.installations);
  assert.equal(yacht.id, 151734);
  assert.equal(ess.id, 219742);
  assert.equal(ess.name, 'ESS System');
  assert.equal(ess.timezone, 'Africa/Casablanca');
  assert.equal(ess.hasMains, true);
  assert.equal(ess.hasGenerator, true);
  assert.equal(ess.lastAt, 1792856441 * 1000);
  assert.equal(ess.alarm, false);
  assert.equal(ess.alarmCount, 0);
  assert.deepEqual(ess.currentAlarms, []);
  assert.deepEqual(ess.values, {
    soc: 48,
    voltage: 49.01,
    current: -8.4,
    batteryState: 2,
    systemState: 'Recharging',
    gridAlarm: 0,
    pv: -1.5,
    load: 351,
    grid: -33.8,
    generator: null,
  });
  // `S` (VE.Bus state) and `s` (switch position) differ by case only.
  assert.equal(yacht.values.systemState, 'Absorption');
  assert.equal(yacht.values.current, 74.6);
});

test('installations: broken records are skipped, duplicates once, sorted by id', () => {
  const sites = parseInstallations({
    records: [
      { idSite: 9, name: '  Van  ', extended: 'nope', last_timestamp: 0 },
      { idSite: 'x' },
      null,
      { idSite: 3, num_alarms: 2, current_alarms: ['Low battery', { description: 'Overload' }] },
      { idSite: 9, name: 'again' },
    ],
  });
  assert.deepEqual(
    sites.map((site) => [site.id, site.name, site.lastAt, site.alarmCount]),
    [
      [3, 'VRM 3', null, 2],
      [9, 'Van', null, null],
    ],
  );
  assert.deepEqual(sites[0].currentAlarms, ['Low battery', 'Overload']);
  assert.equal(sites[1].values.soc, null);
  assert.deepEqual(parseInstallations(null), []);
});

test('stats?type=kwh (live shape): solar, consumption, import, export from the flows', () => {
  const { totals, hours } = parseKwh(live.kwh);
  // Pb + Pg + Pc; Pc + Bc; Pg + Bg; Pb; Bc + Bg (no Gc / Gb / gc / gb that day).
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(close(totals.solar, 5.852825014095288 + 17.733682692050934 + 13.092757806996815));
  assert.ok(close(totals.consumption, 13.092757806996815 + 5.157622947823256));
  assert.equal(totals.gridImport, 0);
  assert.ok(close(totals.gridExport, 17.733682692050934 + 0.5379869269672781));
  assert.ok(close(totals.charge, 5.852825014095288));
  assert.ok(close(totals.discharge, 5.157622947823256 + 0.5379869269672781));
  assert.equal(hours.length, 1);
  assert.equal(hours[0].at, 1792800000000);
  // Nothing taken from the grid: fully self-sufficient.
  assert.equal(selfSufficiency(totals), 100);
});

test('stats?type=kwh with no data at all ({ kwh: false }) is null, not zeros', () => {
  assert.deepEqual(parseKwh({ success: true, records: { kwh: false }, totals: { kwh: false } }), {
    totals: null,
    hours: [],
  });
  assert.equal(energiesOf({}), null);
  assert.equal(selfSufficiency(null), null);
  assert.equal(selfSufficiency({ consumption: 0, fromGrid: 0 }), null);
  assert.equal(selfSufficiency({ consumption: 10, fromGrid: 2.5 }), 75);
});

test('stats?type=forecast (live shape): [ms, Wh] per hour, false is none', () => {
  const forecast = parseForecast(live.forecast);
  assert.equal(forecast.solar.length, 25);
  assert.equal(forecast.consumption.length, 25);
  assert.deepEqual(forecast.solar[0], [1792852904000, 1479.4705116729428]);
  assert.deepEqual(parseForecast({ records: { solar_yield_forecast: false } }), {
    solar: null,
    consumption: null,
  });
});

test('alarm-log: active first, then the latest; an empty log (live shape) is empty', () => {
  assert.deepEqual(parseAlarmLog(live.alarmLogEmpty), []);
  const alarms = parseAlarmLog({
    success: true,
    records: [
      {
        idAlarm: 1,
        description: 'Low battery',
        started: 100,
        cleared: 200,
        isActive: 0,
        device: 'Multi',
      },
      {
        idAlarm: 2,
        description: 'Grid lost alarm',
        started: 300,
        cleared: null,
        isActive: 1,
        device: 'Gateway',
        customName: 'Cerbo',
      },
      { idAlarm: 3, nameEnum: 'Overload', started: 400, cleared: 500, isActive: 0 },
      { idAlarm: 2, description: 'duplicate' },
      { description: 'no id' },
    ],
  });
  assert.deepEqual(alarms, [
    {
      id: 2,
      description: 'Grid lost alarm',
      device: 'Cerbo',
      instance: null,
      started: 300000,
      cleared: null,
      active: true,
    },
    {
      id: 3,
      description: 'Overload',
      device: null,
      instance: null,
      started: 400000,
      cleared: 500000,
      active: false,
    },
    {
      id: 1,
      description: 'Low battery',
      device: 'Multi',
      instance: null,
      started: 100000,
      cleared: 200000,
      active: false,
    },
  ]);
});
