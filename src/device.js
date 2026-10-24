// -----------------------------------------------------------------------------
// The devices of the integration, offered on the Discovery screen.
//
// One device per VRM installation (its idSite, the id VRM never reuses),
// read-only, in a stable order. The categories follow the contracts of the
// Gladys core (server/utils/constants.js, the same in 5.1.0 and on master):
//   - `battery_level`           battery-storage / battery-level (%);
//   - `battery_charge_power`    battery-storage / charge-power (W, >= 0) and
//   - `battery_discharge_power` battery-storage / discharge-power (W, >= 0):
//                               the core splits the two directions; VRM gives
//                               the battery voltage and the signed current
//                               (> 0 charging), the power is their product;
//   - `battery_voltage`         energy-sensor / voltage (V): 12 / 24 / 48 V
//                               systems, the first thing an owner watches;
//   - `pv_power`                energy-production-sensor / power (W);
//   - `pv_today`                energy-production-sensor / daily-production (kWh);
//   - `grid_power`              grid-sensor / power (W, signed: import > 0,
//                               export < 0, as `from_to_grid` natively is);
//   - `load_power`              energy-sensor / power (W): the AC loads the
//                               Victron system measures;
//   - `load_today`              energy-sensor / index-today (kWh): not
//                               `daily-consumption`, that Gladys would price
//                               and count twice with the meter of the house;
//   - `generator_power`         energy-production-sensor / power (W).
// No energy-sensor / index: it would feed the consumption and the cost of
// Gladys and count the house twice next to a Linky. The battery, solar, grid
// and generator features exist only when the installation has them (a value
// seen once, `hasMains`, `hasGenerator`, `pvMax`); once there, they stay.
//
// External ids: `ext:victron-vrm:site:<idSite>`, features `…:<key>`.
// `should_poll` stays false: the integration reads the cloud on its own timer.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { t } from './i18n.js';

const SITE_TYPE = 'site';
const MAX_POWER = 100000;
const MAX_DAY_KWH = 2000;
const MAX_VOLTAGE = 1000;

const SITE_FEATURES = [
  {
    key: 'battery_level',
    category: C.BATTERY_STORAGE,
    type: T.BATTERY_STORAGE.BATTERY_LEVEL,
    unit: U.PERCENT,
    min: 0,
    max: 100,
    part: 'battery',
  },
  {
    key: 'battery_charge_power',
    category: C.BATTERY_STORAGE,
    type: T.BATTERY_STORAGE.CHARGE_POWER,
    unit: U.WATT,
    min: 0,
    max: MAX_POWER,
    part: 'battery',
  },
  {
    key: 'battery_discharge_power',
    category: C.BATTERY_STORAGE,
    type: T.BATTERY_STORAGE.DISCHARGE_POWER,
    unit: U.WATT,
    min: 0,
    max: MAX_POWER,
    part: 'battery',
  },
  {
    key: 'battery_voltage',
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.VOLTAGE,
    unit: U.VOLT,
    min: 0,
    max: MAX_VOLTAGE,
    part: 'battery',
  },
  {
    key: 'pv_power',
    category: C.ENERGY_PRODUCTION_SENSOR,
    type: T.ENERGY_PRODUCTION_SENSOR.POWER,
    unit: U.WATT,
    min: 0,
    max: MAX_POWER,
    part: 'solar',
  },
  {
    key: 'pv_today',
    category: C.ENERGY_PRODUCTION_SENSOR,
    type: T.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
    unit: U.KILOWATT_HOUR,
    min: 0,
    max: MAX_DAY_KWH,
    part: 'solar',
  },
  {
    key: 'grid_power',
    category: C.GRID_SENSOR,
    type: T.GRID_SENSOR.POWER,
    unit: U.WATT,
    min: -MAX_POWER,
    max: MAX_POWER,
    part: 'grid',
  },
  {
    key: 'load_power',
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.POWER,
    unit: U.WATT,
    min: 0,
    max: MAX_POWER,
  },
  {
    key: 'load_today',
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.INDEX_TODAY,
    unit: U.KILOWATT_HOUR,
    min: 0,
    max: MAX_DAY_KWH,
  },
  {
    key: 'generator_power',
    category: C.ENERGY_PRODUCTION_SENSOR,
    type: T.ENERGY_PRODUCTION_SENSOR.POWER,
    unit: U.WATT,
    min: 0,
    max: MAX_POWER,
    part: 'generator',
  },
];

const PARTS = ['battery', 'solar', 'grid', 'generator'];
const DECIMALS = { battery_level: 1, battery_voltage: 2 };
const KWH_DECIMALS = 3;

/**
 * @description Round a value to the decimals of its feature.
 * @param {object} feature - The feature description.
 * @param {number} value - The value.
 * @returns {number} The rounded value.
 */
function round(feature, value) {
  const decimals = DECIMALS[feature.key] ?? (feature.unit === U.KILOWATT_HOUR ? KWH_DECIMALS : 0);
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * @description The external ids of an installation.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {number} id - The idSite.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const siteIds = (gladys, id) => gladys.externalIds(SITE_TYPE, String(id));

/**
 * @description The idSite of a device (or feature) external id.
 * @param {unknown} externalId - The id.
 * @returns {number|null} The idSite.
 * @example
 * siteOfExternalId('ext:victron-vrm:site:151734:pv_power'); // -> 151734
 */
function siteOfExternalId(externalId) {
  const match = new RegExp(`:${SITE_TYPE}:(\\d{1,12})(?::[a-z_]+)?$`).exec(
    String(externalId ?? ''),
  );
  return match ? Number(match[1]) : null;
}

/**
 * @description The feature keys of an installation, in a stable order.
 * @param {object} parts - `{ battery, solar, grid, generator }` booleans.
 * @returns {string[]} The keys.
 */
const siteFeatureKeys = (parts = {}) =>
  SITE_FEATURES.filter((feature) => !feature.part || parts[feature.part]).map(
    (feature) => feature.key,
  );

/**
 * @description A feature of a discovered device.
 * @param {object} ids - The external ids of the device.
 * @param {object} feature - The feature description.
 * @param {string} language - Language of its name.
 * @returns {object} The feature.
 */
function buildFeature(ids, feature, language) {
  return {
    name: t(`feature_${feature.key}`, language),
    external_id: ids.feature(feature.key),
    category: feature.category,
    type: feature.type,
    unit: feature.unit,
    min: feature.min,
    max: feature.max,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

/**
 * @description The device name of an installation: "Victron Boat" — the name
 * given in VRM, prefixed to tell it from the other devices.
 * @param {object} site - `{ id, name }`.
 * @returns {string} The name.
 */
function siteName(site) {
  const name = String(site.name ?? '').trim() || `VRM ${site.id}`;
  return (/victron/i.test(name) ? name : `Victron ${name}`).slice(0, 100);
}

/**
 * @description Build the device of an installation.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} site - `{ id, name, identifier, parts }`.
 * @param {string} [language] - Language of the feature names.
 * @returns {object} The discovered device.
 */
function buildSiteDevice(gladys, site, language = 'en') {
  const ids = siteIds(gladys, site.id);
  return {
    name: siteName(site),
    external_id: ids.device,
    model: 'Victron VRM installation',
    should_poll: false,
    params: [
      { name: 'VRM_SITE_ID', value: String(site.id) },
      ...(site.identifier ? [{ name: 'VRM_PORTAL_ID', value: String(site.identifier) }] : []),
    ],
    features: siteFeatureKeys(site.parts).map((key) =>
      buildFeature(
        ids,
        SITE_FEATURES.find((feature) => feature.key === key),
        language,
      ),
    ),
  };
}

/**
 * @description The states of an installation: a value left out (null) is left untouched.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} site - `{ id, parts }`.
 * @param {object} values - `{ pv_power, … }` in W, %, V, kWh; null = unknown.
 * @returns {object[]} `{ device_feature_external_id, state }`.
 */
function buildSiteStates(gladys, site, values) {
  const ids = siteIds(gladys, site.id);
  const keys = siteFeatureKeys(site.parts);
  return SITE_FEATURES.filter(
    (feature) => keys.includes(feature.key) && Number.isFinite(values?.[feature.key]),
  ).map((feature) => ({
    device_feature_external_id: ids.feature(feature.key),
    state: Math.min(feature.max, Math.max(feature.min, round(feature, values[feature.key]))),
  }));
}

/**
 * @description The power of the battery, W: voltage × current (> 0 charging).
 * @param {object} values - parseValues().
 * @returns {number|null} The power.
 */
function batteryPower(values) {
  if (!Number.isFinite(values?.voltage) || !Number.isFinite(values?.current)) {
    return null;
  }
  return values.voltage * values.current;
}

/**
 * @description The values of the features from the latest values of an installation.
 * @param {object|null} values - parseValues() (fresh), or null.
 * @returns {object} `{ battery_level, … }`, null when unknown.
 */
function liveValues(values) {
  if (!values) {
    return {};
  }
  const battery = batteryPower(values);
  const positive = (value) => (Number.isFinite(value) ? Math.max(0, value) : null);
  return {
    battery_level: values.soc,
    battery_charge_power: battery === null ? null : Math.max(0, battery),
    battery_discharge_power: battery === null ? null : Math.max(0, -battery),
    battery_voltage: values.voltage,
    pv_power: positive(values.pv),
    grid_power: values.grid,
    load_power: positive(values.load),
    generator_power: positive(values.generator),
  };
}

/**
 * @description The parts of an installation, given what VRM says and what was seen.
 * @param {object} site - parseInstallations() record.
 * @param {object} [known] - The parts known before (they never go away).
 * @returns {object} `{ battery, solar, grid, generator }`.
 */
function partsOf(site, known = {}) {
  const values = site.values ?? {};
  return {
    battery: Boolean(known.battery) || Number.isFinite(values.soc),
    solar: Boolean(known.solar) || Number.isFinite(values.pv) || site.pvMax > 0,
    grid: Boolean(known.grid) || Number.isFinite(values.grid) || site.hasMains === true,
    generator:
      Boolean(known.generator) || Number.isFinite(values.generator) || site.hasGenerator === true,
  };
}

export {
  SITE_TYPE,
  SITE_FEATURES,
  PARTS,
  siteIds,
  siteOfExternalId,
  siteFeatureKeys,
  siteName,
  buildSiteDevice,
  buildSiteStates,
  batteryPower,
  liveValues,
  partsOf,
};
