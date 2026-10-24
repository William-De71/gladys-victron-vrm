// The traps of the Gladys core that the fake Gladys does not catch
// (community feedback, thread 11005): should_poll with poll_frequency, min /
// max / read_only / has_feedback on every feature, category / type / unit
// pairs the core knows (DEVICE_FEATURE_UNITS_BY_CATEGORY of
// server/utils/constants.js, the same in 5.1.0 and on master), a signed grid
// power with symmetric bounds, and a single invalid field rejecting the whole
// discovery batch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  siteIds,
  siteOfExternalId,
  buildSiteDevice,
  buildSiteStates,
  liveValues,
  partsOf,
  siteFeatureKeys,
  siteName,
  SITE_FEATURES,
} from '../src/device.js';
import { LANGUAGES } from '../src/i18n.js';

const fakeGladys = {
  externalIds: (type, id) => ({
    device: `ext:victron-vrm:${type}:${id}`,
    feature: (key) => `ext:victron-vrm:${type}:${id}:${key}`,
  }),
};
const ALL = { battery: true, solar: true, grid: true, generator: true };
const HOME = { id: 101, name: 'Home ESS', identifier: 'c0ffee000101', parts: ALL };
const BOAT = {
  id: 202,
  name: 'Sailboat',
  identifier: null,
  parts: { battery: true, solar: false, grid: false, generator: false },
};

// The units the core accepts per category (server/utils/constants.js,
// DEVICE_FEATURE_UNITS_BY_CATEGORY, read on v5.1.0 and upstream/master on 2026-10-23).
const UNITS_BY_CATEGORY = {
  [C.ENERGY_PRODUCTION_SENSOR]: [U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
  [C.BATTERY_STORAGE]: [U.PERCENT, U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
  [C.GRID_SENSOR]: [U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
  [C.ENERGY_SENSOR]: [U.VOLT, U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
};
const PAIRS = {
  battery_level: [C.BATTERY_STORAGE, T.BATTERY_STORAGE.BATTERY_LEVEL, U.PERCENT],
  battery_charge_power: [C.BATTERY_STORAGE, T.BATTERY_STORAGE.CHARGE_POWER, U.WATT],
  battery_discharge_power: [C.BATTERY_STORAGE, T.BATTERY_STORAGE.DISCHARGE_POWER, U.WATT],
  battery_voltage: [C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE, U.VOLT],
  pv_power: [C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.POWER, U.WATT],
  pv_today: [
    C.ENERGY_PRODUCTION_SENSOR,
    T.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
    U.KILOWATT_HOUR,
  ],
  grid_power: [C.GRID_SENSOR, T.GRID_SENSOR.POWER, U.WATT],
  load_power: [C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, U.WATT],
  load_today: [C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX_TODAY, U.KILOWATT_HOUR],
  generator_power: [C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.POWER, U.WATT],
};
const keyOf = (feature) => feature.external_id.split(':').pop();

test('devices are never polled by Gladys: the integration has its own timer', () => {
  const device = buildSiteDevice(fakeGladys, HOME);
  assert.equal(device.should_poll, false);
  assert.equal(device.poll_frequency, undefined);
});

test('every feature carries min, max, read_only and has_feedback, in every language', () => {
  for (const language of LANGUAGES) {
    for (const device of [
      buildSiteDevice(fakeGladys, HOME, language),
      buildSiteDevice(fakeGladys, BOAT, language),
    ]) {
      for (const feature of device.features) {
        assert.equal(typeof feature.min, 'number', feature.external_id);
        assert.equal(typeof feature.max, 'number', feature.external_id);
        assert.ok(feature.min < feature.max);
        assert.equal(feature.read_only, true);
        assert.equal(feature.has_feedback, false);
        assert.ok(feature.name.length > 0 && feature.name.length <= 100);
      }
      assert.equal(new Set(device.features.map((f) => f.name)).size, device.features.length);
    }
  }
});

test('category / type / unit pairs of the core contracts; no energy-sensor index, no daily consumption', () => {
  const device = buildSiteDevice(fakeGladys, HOME);
  assert.deepEqual(device.features.map(keyOf), Object.keys(PAIRS));
  for (const feature of device.features) {
    const key = keyOf(feature);
    assert.deepEqual([feature.category, feature.type, feature.unit], PAIRS[key], key);
    assert.ok(UNITS_BY_CATEGORY[feature.category].includes(feature.unit), key);
    if (feature.category === C.ENERGY_SENSOR) {
      assert.notEqual(feature.type, T.ENERGY_SENSOR.DAILY_CONSUMPTION, 'Gladys would price it');
      assert.notEqual(feature.type, T.ENERGY_SENSOR.INDEX, 'it would count as a meter');
      assert.notEqual(feature.type, T.ENERGY_SENSOR.ENERGY, 'it would count as a meter');
    }
    if (feature.category === C.BATTERY_STORAGE) {
      assert.ok(feature.min >= 0, `${key}: the core wants battery powers >= 0`);
    }
  }
  const grid = device.features.find((feature) => keyOf(feature) === 'grid_power');
  assert.equal(grid.min, -grid.max, 'a signed power has symmetric bounds');
  const level = device.features.find((feature) => keyOf(feature) === 'battery_level');
  assert.deepEqual([level.min, level.max], [0, 100]);
});

test('an installation without solar, grid or generator has none of their features', () => {
  const device = buildSiteDevice(fakeGladys, BOAT, 'fr');
  assert.deepEqual(device.features.map(keyOf), [
    'battery_level',
    'battery_charge_power',
    'battery_discharge_power',
    'battery_voltage',
    'load_power',
    'load_today',
  ]);
  assert.equal(device.name, 'Victron Sailboat');
  assert.equal(device.features[0].name, 'Niveau de batterie');
  assert.deepEqual(device.params, [{ name: 'VRM_SITE_ID', value: '202' }]);
  assert.deepEqual(
    buildSiteDevice(fakeGladys, HOME).params.map((param) => param.name),
    ['VRM_SITE_ID', 'VRM_PORTAL_ID'],
  );
  assert.deepEqual(
    siteFeatureKeys(ALL),
    SITE_FEATURES.map((feature) => feature.key),
  );
  assert.deepEqual(siteFeatureKeys(), ['load_power', 'load_today']);
});

test('names: the VRM name prefixed with Victron, unless it already says it', () => {
  assert.equal(siteName({ id: 1, name: 'Van' }), 'Victron Van');
  assert.equal(siteName({ id: 1, name: 'Victron Cerbo home' }), 'Victron Cerbo home');
  assert.equal(siteName({ id: 7, name: '' }), 'Victron VRM 7');
});

test('parts: from VRM and from the values seen; once there, they stay', () => {
  const site = {
    hasMains: false,
    hasGenerator: true,
    pvMax: 0,
    values: { soc: 50, pv: null, grid: null, generator: null },
  };
  assert.deepEqual(partsOf(site), { battery: true, solar: false, grid: false, generator: true });
  assert.deepEqual(partsOf({ ...site, values: { pv: 120 } }, { battery: true }), {
    battery: true,
    solar: true,
    grid: false,
    generator: true,
  });
  assert.deepEqual(partsOf({ values: {}, pvMax: 3000, hasMains: true }), {
    battery: false,
    solar: true,
    grid: true,
    generator: false,
  });
});

test('ids from the idSite', () => {
  assert.equal(siteOfExternalId('ext:victron-vrm:site:101:pv_power'), 101);
  assert.equal(siteOfExternalId('ext:victron-vrm:site:101'), 101);
  assert.equal(siteOfExternalId('ext:victron-vrm:site:abc'), null);
  assert.equal(siteOfExternalId(null), null);
});

test('the battery power is voltage × current, split into charge and discharge, both >= 0', () => {
  const discharging = liveValues({
    soc: 72,
    voltage: 52.4,
    current: -8.5,
    pv: -1.5,
    load: 640,
    grid: -210,
    generator: null,
  });
  assert.deepEqual(discharging, {
    battery_level: 72,
    battery_charge_power: 0,
    battery_discharge_power: 52.4 * 8.5,
    battery_voltage: 52.4,
    pv_power: 0,
    grid_power: -210,
    load_power: 640,
    generator_power: null,
  });
  const charging = liveValues({ soc: 88, voltage: 13.31, current: 4.2 });
  assert.deepEqual(
    [charging.battery_charge_power, charging.battery_discharge_power],
    [13.31 * 4.2, 0],
  );
  assert.equal(liveValues({ soc: 50, voltage: null, current: 3 }).battery_charge_power, null);
  assert.deepEqual(liveValues(null), {});
});

test('states: rounded, clamped to the bounds, an unknown value left untouched', () => {
  const states = buildSiteStates(fakeGladys, BOAT, {
    battery_level: 87.96,
    battery_voltage: 13.3149,
    load_power: 95.4,
    load_today: 2.34567,
    pv_power: 1200,
    battery_charge_power: null,
  });
  assert.deepEqual(states, [
    { device_feature_external_id: 'ext:victron-vrm:site:202:battery_level', state: 88 },
    { device_feature_external_id: 'ext:victron-vrm:site:202:battery_voltage', state: 13.31 },
    { device_feature_external_id: 'ext:victron-vrm:site:202:load_power', state: 95 },
    { device_feature_external_id: 'ext:victron-vrm:site:202:load_today', state: 2.346 },
  ]);
  const clamped = buildSiteStates(fakeGladys, HOME, { grid_power: -250000 });
  assert.deepEqual(
    clamped.map((state) => state.state),
    [-100000],
  );
});

test('the discovery batch and the states pass the checks of the fake host API', async (t) => {
  const gladys = createFakeGladys({});
  t.after(() => gladys.fake.shutdown());
  await gladys.connect();
  for (const language of LANGUAGES) {
    await gladys.publishDiscoveredDevices([
      buildSiteDevice(gladys, HOME, language),
      buildSiteDevice(gladys, BOAT, language),
    ]);
  }
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  const values = Object.fromEntries(
    SITE_FEATURES.map((feature, index) => [feature.key, index + 1]),
  );
  await gladys.publishStates(buildSiteStates(gladys, HOME, values));
  assert.equal(gladys.fake.lastState(siteIds(gladys, HOME.id).feature('grid_power')), 7);
  assert.equal(gladys.fake.lastState(siteIds(gladys, HOME.id).feature('battery_voltage')), 4);
});
