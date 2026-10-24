// -----------------------------------------------------------------------------
// Scene triggers and the keys of the scene actions.
//
// Triggers, once per transition, never at the first reading, never because of
// a scene action:
//   - `alarm_raised`          a new active entry in the VRM alarm log of an
//                             installation (low battery, grid lost, overload,
//                             high temperature, inverter error…);
//   - `alarm_cleared`         an entry seen active is cleared (or gone);
//   - `battery_low`           the battery level reaches the level of the
//                             configuration (20 % by default); again once it
//                             went 5 points above;
//   - `battery_full`          the battery level reaches 100 % (99.5 rounded);
//                             again once it went back under 95 %;
//   - `grid_lost`             the grid alarm of the system (Agl) goes off: the
//                             mains / shore power is gone;
//   - `grid_restored`         it comes back;
//   - `installation_offline`  VRM received nothing from the installation for
//                             the delay of the configuration (60 min by default);
//   - `installation_online`   data arrives again after that;
//   - `access_refused`        VRM refuses the access token (revoked, expired,
//                             wrong) or the installations.
// A value to compare (>, <) is a feature of the device, not a trigger.
// -----------------------------------------------------------------------------

const TRIGGERS = {
  ALARM_RAISED: 'alarm_raised',
  ALARM_CLEARED: 'alarm_cleared',
  BATTERY_LOW: 'battery_low',
  BATTERY_FULL: 'battery_full',
  GRID_LOST: 'grid_lost',
  GRID_RESTORED: 'grid_restored',
  INSTALLATION_OFFLINE: 'installation_offline',
  INSTALLATION_ONLINE: 'installation_online',
  ACCESS_REFUSED: 'access_refused',
};

const SCENE_ACTIONS = {
  GET_TODAY: 'get_today',
  GET_FORECAST: 'get_forecast',
};

const TODAY_OUTPUTS = [
  'solar_kwh',
  'consumption_kwh',
  'import_kwh',
  'export_kwh',
  'charge_kwh',
  'discharge_kwh',
  'generator_kwh',
  'self_sufficiency',
  'battery_level',
  'summary',
];
const FORECAST_OUTPUTS = [
  'solar_today_kwh',
  'solar_remaining_kwh',
  'solar_tomorrow_kwh',
  'consumption_today_kwh',
  'consumption_tomorrow_kwh',
  'summary',
];
const ACCESS_REASONS = ['auth', 'forbidden'];

const FULL_SOC = 99.5;
const FULL_REARM_SOC = 95;
const LOW_REARM = 5;
// How many alarms the triggers remember (the log is read 25 entries at a time).
const MAX_REMEMBERED = 50;

/**
 * @description Keep only the declared keys of an output object.
 * @param {object} values - The values.
 * @param {string[]} keys - The declared keys.
 * @returns {object} The outputs (null / undefined left out).
 */
function pick(values, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => values[key] !== null && values[key] !== undefined)
      .map((key) => [key, values[key]]),
  );
}

/**
 * @description The battery transitions of a fresh reading.
 * @param {object} seen - What the triggers knew (never changed).
 * @param {number|null} soc - The battery level (%).
 * @param {number} lowLevel - The level of `battery_low` (%).
 * @returns {{ events: string[], next: object }} The trigger keys, the new knowledge.
 */
function detectBattery(seen, soc, lowLevel) {
  const next = { ...seen };
  const events = [];
  if (!Number.isFinite(soc)) {
    return { events, next };
  }
  const first = !seen.batteryKnown;
  next.batteryKnown = true;
  if (soc >= FULL_SOC) {
    if (!seen.full && !first) events.push(TRIGGERS.BATTERY_FULL);
    next.full = true;
  } else if (soc < FULL_REARM_SOC || first) {
    next.full = false;
  }
  if (soc <= lowLevel) {
    if (!seen.low && !first) events.push(TRIGGERS.BATTERY_LOW);
    next.low = true;
  } else if (soc >= lowLevel + LOW_REARM || first) {
    next.low = false;
  }
  return { events, next };
}

/**
 * @description The grid transitions of a fresh reading of the grid alarm.
 * @param {object} seen - What the triggers knew (never changed).
 * @param {number|null} gridAlarm - The `Agl` value: 0 ok, more: grid lost.
 * @param {number} now - Now (ms).
 * @returns {{ events: string[], next: object, minutes: number|null }} The
 * triggers, the new knowledge, how long the grid was lost (when restored).
 */
function detectGrid(seen, gridAlarm, now) {
  const next = { ...seen };
  const events = [];
  let minutes = null;
  if (!Number.isFinite(gridAlarm)) {
    return { events, next, minutes };
  }
  const lost = gridAlarm > 0;
  if (seen.gridLost === undefined || seen.gridLost === null) {
    next.gridLost = lost;
    next.gridLostSince = lost ? now : null;
    return { events, next, minutes };
  }
  if (lost && !seen.gridLost) {
    events.push(TRIGGERS.GRID_LOST);
    next.gridLostSince = now;
  } else if (!lost && seen.gridLost) {
    events.push(TRIGGERS.GRID_RESTORED);
    minutes = Number.isFinite(seen.gridLostSince)
      ? Math.round((now - seen.gridLostSince) / 60000)
      : null;
    next.gridLostSince = null;
  }
  next.gridLost = lost;
  return { events, next, minutes };
}

/**
 * @description The offline / online transitions of an installation, from the
 * time of its last data.
 * @param {object} seen - What the triggers knew (never changed).
 * @param {object} reading - `{ lastAt, now, offlineMs }`.
 * @returns {{ events: string[], next: object, minutes: number|null }} The
 * triggers, the new knowledge, how long it has been (or was) silent.
 */
function detectOffline(seen, { lastAt, now, offlineMs }) {
  const next = { ...seen };
  const events = [];
  if (!Number.isFinite(lastAt)) {
    return { events, next, minutes: null };
  }
  const silent = now - lastAt;
  const offline = silent > offlineMs;
  const minutes = Math.max(0, Math.round(silent / 60000));
  if (seen.offline === undefined || seen.offline === null) {
    next.offline = offline;
    next.offlineSince = offline ? lastAt : null;
    return { events, next, minutes };
  }
  if (offline && !seen.offline) {
    events.push(TRIGGERS.INSTALLATION_OFFLINE);
    next.offlineSince = lastAt;
  }
  let wasMinutes = minutes;
  if (!offline && seen.offline) {
    events.push(TRIGGERS.INSTALLATION_ONLINE);
    wasMinutes = Number.isFinite(seen.offlineSince)
      ? Math.max(0, Math.round((lastAt - seen.offlineSince) / 60000))
      : null;
    next.offlineSince = null;
  }
  next.offline = offline;
  return { events, next, minutes: wasMinutes };
}

/**
 * @description The alarms raised and cleared since the last reading of the log.
 * @param {object} seen - What the triggers knew (never changed): `{ alarmsKnown,
 * active: { [id]: { description, device, started } } }`.
 * @param {object[]} alarms - parseAlarmLog().
 * @returns {{ raised: object[], cleared: object[], next: object }} The alarms,
 * the new knowledge.
 */
function detectAlarms(seen, alarms) {
  const next = { ...seen };
  const before = seen.active && typeof seen.active === 'object' ? seen.active : {};
  const first = !seen.alarmsKnown;
  const active = {};
  for (const alarm of alarms.filter((item) => item.active).slice(0, MAX_REMEMBERED)) {
    active[alarm.id] = {
      description: alarm.description,
      device: alarm.device,
      started: alarm.started,
    };
  }
  const raised = first
    ? []
    : alarms.filter((alarm) => alarm.active && !Object.hasOwn(before, alarm.id));
  const cleared = first
    ? []
    : Object.keys(before)
        .filter((id) => !Object.hasOwn(active, id))
        .map((id) => {
          const entry = alarms.find((alarm) => String(alarm.id) === id);
          return entry ?? { id: Number(id), ...before[id], cleared: null, active: false };
        });
  next.alarmsKnown = true;
  next.active = active;
  return { raised, cleared, next };
}

/**
 * @description The data of an event about an installation.
 * @param {object} view - `{ deviceId, name, id }`.
 * @param {object} [extra] - More scalar values.
 * @returns {object} Flat data.
 */
function siteData(view, extra = {}) {
  return {
    installation: view.deviceId,
    installation_name: view.name,
    site_id: view.id,
    ...extra,
  };
}

/**
 * @description The data of an alarm event.
 * @param {object} view - The view of the installation.
 * @param {object} alarm - An entry of parseAlarmLog().
 * @param {number} now - Now (ms).
 * @returns {object} Flat data.
 */
function alarmData(view, alarm, now) {
  const iso = (value) => (Number.isFinite(value) ? new Date(value).toISOString() : null);
  const end = Number.isFinite(alarm.cleared) ? alarm.cleared : now;
  return siteData(view, {
    alarm_id: alarm.id,
    description: String(alarm.description ?? '').slice(0, 1000),
    alarm_device: alarm.device ?? null,
    started_at: iso(alarm.started),
    cleared_at: iso(alarm.cleared),
    duration_minutes: Number.isFinite(alarm.started)
      ? Math.max(0, Math.round((end - alarm.started) / 60000))
      : null,
  });
}

/**
 * @description Round to a number of decimals, null when unknown.
 * @param {number|null} value - The value.
 * @param {number} [decimals] - Decimals.
 * @returns {number|null} The rounded value.
 */
function rounded(value, decimals = 0) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export {
  TRIGGERS,
  SCENE_ACTIONS,
  TODAY_OUTPUTS,
  FORECAST_OUTPUTS,
  ACCESS_REASONS,
  FULL_SOC,
  LOW_REARM,
  pick,
  detectBattery,
  detectGrid,
  detectOffline,
  detectAlarms,
  siteData,
  alarmData,
  rounded,
};
