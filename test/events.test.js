// The scene triggers: one event per transition, never at the first reading,
// with hysteresis on the battery.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRIGGERS,
  detectBattery,
  detectGrid,
  detectOffline,
  detectAlarms,
  alarmData,
  siteData,
  pick,
  rounded,
} from '../src/events.js';

const MINUTE = 60 * 1000;

/**
 * @description Run a sequence of battery levels.
 * @param {number[]} levels - The levels.
 * @param {number} [low] - The low level.
 * @returns {string[][]} The events of each reading.
 */
function battery(levels, low = 20) {
  let seen = {};
  return levels.map((soc) => {
    const { events, next } = detectBattery(seen, soc, low);
    seen = next;
    return events;
  });
}

test('battery low: at the level of the configuration, again only 5 points above', () => {
  assert.deepEqual(battery([30, 21, 20, 19, 22, 18, 25, 20]), [
    [],
    [],
    [TRIGGERS.BATTERY_LOW],
    [],
    [],
    [],
    [],
    [TRIGGERS.BATTERY_LOW],
  ]);
  assert.deepEqual(battery([50, 30], 30), [[], [TRIGGERS.BATTERY_LOW]]);
});

test('battery full: at 99.5 %, again only after going under 95 %', () => {
  assert.deepEqual(battery([90, 99.6, 98, 100, 94, 100]), [
    [],
    [TRIGGERS.BATTERY_FULL],
    [],
    [],
    [],
    [TRIGGERS.BATTERY_FULL],
  ]);
});

test('never at the first reading, nothing for an unknown level', () => {
  assert.deepEqual(battery([100, 10]), [[], [TRIGGERS.BATTERY_LOW]]);
  assert.deepEqual(battery([10, 10, 100]), [[], [], [TRIGGERS.BATTERY_FULL]]);
  assert.deepEqual(battery([null, 10]), [[], []]);
});

test('grid lost / restored from the grid alarm, with how long it was lost', () => {
  let seen = {};
  const run = (value, now) => {
    const result = detectGrid(seen, value, now);
    seen = result.next;
    return [result.events, result.minutes];
  };
  assert.deepEqual(run(0, 0), [[], null]);
  assert.deepEqual(run(2, MINUTE), [[TRIGGERS.GRID_LOST], null]);
  assert.deepEqual(run(2, 5 * MINUTE), [[], null]);
  assert.deepEqual(run(null, 6 * MINUTE), [[], null]);
  assert.deepEqual(run(0, 31 * MINUTE), [[TRIGGERS.GRID_RESTORED], 30]);
  // Lost at startup: no event, but its end is one.
  seen = {};
  assert.deepEqual(run(1, 0), [[], null]);
  assert.deepEqual(run(0, 10 * MINUTE), [[TRIGGERS.GRID_RESTORED], 10]);
});

test('offline after the delay without new data, online when data comes back', () => {
  let seen = {};
  const offlineMs = 60 * MINUTE;
  const run = (lastAt, now) => {
    const result = detectOffline(seen, { lastAt, now, offlineMs });
    seen = result.next;
    return [result.events, result.minutes];
  };
  assert.deepEqual(run(0, 10 * MINUTE), [[], 10]);
  assert.deepEqual(run(0, 60 * MINUTE), [[], 60]);
  assert.deepEqual(run(0, 61 * MINUTE), [[TRIGGERS.INSTALLATION_OFFLINE], 61]);
  assert.deepEqual(run(0, 90 * MINUTE), [[], 90]);
  // The data of 100 min arrives at 102 min: it was silent from 0 to 100.
  assert.deepEqual(run(100 * MINUTE, 102 * MINUTE), [[TRIGGERS.INSTALLATION_ONLINE], 100]);
  assert.deepEqual(run(null, 200 * MINUTE), [[], null], 'never any data: nothing');
  // Offline at startup: no event.
  seen = {};
  assert.deepEqual(run(0, 5 * 60 * MINUTE), [[], 300]);
});

test('alarms: a new active entry is raised, an entry gone or cleared is cleared', () => {
  const a1 = {
    id: 1,
    description: 'Low battery',
    device: 'Multi',
    started: 1000,
    cleared: null,
    active: true,
  };
  const a2 = {
    id: 2,
    description: 'Grid lost alarm',
    device: 'Gateway',
    started: 2000,
    cleared: null,
    active: true,
  };
  let seen = {};
  const run = (alarms) => {
    const result = detectAlarms(seen, alarms);
    seen = result.next;
    return [result.raised.map((a) => a.id), result.cleared.map((a) => [a.id, a.active])];
  };
  assert.deepEqual(run([a1]), [[], []], 'the first reading only learns');
  assert.deepEqual(run([a2, a1]), [[2], []]);
  assert.deepEqual(run([a2, a1]), [[], []]);
  assert.deepEqual(run([a2, { ...a1, cleared: 5000, active: false }]), [[], [[1, false]]]);
  // Gone from the log altogether: cleared with what was remembered.
  const result = detectAlarms(seen, []);
  assert.deepEqual(result.cleared, [
    {
      id: 2,
      description: 'Grid lost alarm',
      device: 'Gateway',
      started: 2000,
      cleared: null,
      active: false,
    },
  ]);
});

test('event data is flat, scalar, with the device of the installation', () => {
  const view = { id: 101, deviceId: 'ext:victron-vrm:site:101', name: 'Victron Home ESS' };
  const data = alarmData(
    view,
    {
      id: 7,
      description: 'Low battery',
      device: 'Multi',
      started: Date.parse('2026-10-24T10:00:00Z'),
      cleared: null,
    },
    Date.parse('2026-10-24T10:42:00Z'),
  );
  assert.deepEqual(data, {
    installation: 'ext:victron-vrm:site:101',
    installation_name: 'Victron Home ESS',
    site_id: 101,
    alarm_id: 7,
    description: 'Low battery',
    alarm_device: 'Multi',
    started_at: '2026-10-24T10:00:00.000Z',
    cleared_at: null,
    duration_minutes: 42,
  });
  for (const value of Object.values(data)) {
    assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value));
  }
  assert.ok(Object.keys(siteData(view, { a: 1 })).length <= 30);
  assert.deepEqual(pick({ a: 1, b: null, c: undefined, d: 'x' }, ['a', 'b', 'd']), {
    a: 1,
    d: 'x',
  });
  assert.equal(rounded(1.256, 2), 1.26);
  assert.equal(rounded(null), null);
});
