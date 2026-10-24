// -----------------------------------------------------------------------------
// The answers of the VRM API made safe: a value VRM does not give stays null,
// never 0. Shapes checked live on the public VRM demo account on 2026-10-24.
//
// users/{idUser}/installations?extended=1 — one record per installation:
//   idSite, name, identifier, timezone, hasMains, hasGenerator, pvMax,
//   last_timestamp (Unix s), alarm, num_alarms, current_alarms, and
//   `extended`, a list of `{ code, rawValue, formattedValue, textValue }`:
//     bs   battery SOC (%)              bv   battery voltage (V)
//     bc   battery current (A, > 0 charging)
//     bst  battery state (0 idle, 1 charging, 2 discharging)
//     ss   system state (textValue "Bulk", "Inverting"…)
//     Agl  grid alarm (0 "Grid ok", > 0 grid lost)
//     consumption, solar_yield, from_to_grid (import > 0), generator  (W)
//   A value VRM has no data for is `rawValue: null` (seen on the demo for
//   `generator`, and for `solar_yield` on a site without solar). The solar
//   yield can be slightly negative at night (-1.5 W seen): shown as 0.
//
// installations/{idSite}/stats?type=kwh — the energy flows (kWh), each code a
// list of [ms, kWh] and a total; a flow without energy is left out of the
// answer (or `false`), and `{ "kwh": false }` alone means no data at all:
//   Pc / Pb / Pg   solar to consumers / battery / grid
//   Bc / Bg        battery to consumers / grid
//   Gc / Gb        grid to consumers / battery
//   gc / gb        generator to consumers / battery
//   kwh            the sum of all the flows (not used)
//
// installations/{idSite}/stats?type=forecast — `solar_yield_forecast` and
// `vrm_consumption_fc`, lists of [ms, Wh] per hour (or `false`).
//
// installations/{idSite}/alarm-log — records `{ idAlarm, description,
// device, customName, instance, type, started, cleared, isActive, nameEnum }`,
// active first.
// -----------------------------------------------------------------------------

const MAX_NAME = 100;

/**
 * @description A finite number from a JSON value ("49.01", 49.01), else null.
 * @param {unknown} value - The value.
 * @returns {number|null} The number.
 */
function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) {
    return Number(value);
  }
  return null;
}

/**
 * @description A short clean text, else null.
 * @param {unknown} value - The value.
 * @param {number} [max] - The length at most.
 * @returns {string|null} The text.
 */
function toText(value, max = MAX_NAME) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

/**
 * @description The user id of users/me.
 * @param {object} body - The answer.
 * @returns {number|null} The id.
 */
function parseMe(body) {
  const id = toNumber(body?.user?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * @description The extended value of a code.
 * @param {object[]} extended - The `extended` list.
 * @param {string} code - The code (case matters: `S` and `s` differ).
 * @returns {object|null} The entry.
 */
function entryOf(extended, code) {
  return extended.find((entry) => entry && entry.code === code) ?? null;
}

/**
 * @description The values of an installation record.
 * @param {object[]} extended - The `extended` list.
 * @returns {object} `{ soc, voltage, current, batteryState, systemState, gridAlarm,
 * pv, load, grid, generator }`, null when unknown.
 */
function parseValues(extended) {
  const raw = (code) => toNumber(entryOf(extended, code)?.rawValue);
  const soc = raw('bs');
  const batteryState = raw('bst');
  const system = entryOf(extended, 'ss');
  return {
    soc: soc === null ? null : Math.min(100, Math.max(0, soc)),
    voltage: raw('bv'),
    current: raw('bc'),
    batteryState: [0, 1, 2].includes(batteryState) ? batteryState : null,
    systemState: toText(system?.textValue ?? system?.formattedValue, 40),
    gridAlarm: raw('Agl'),
    pv: raw('solar_yield'),
    load: raw('consumption'),
    grid: raw('from_to_grid'),
    generator: raw('generator'),
  };
}

/**
 * @description The installations of users/{idUser}/installations?extended=1.
 * @param {object} body - The answer.
 * @returns {object[]} `{ id, name, identifier, timezone, hasMains, hasGenerator,
 * pvMax, lastAt, alarm, alarmCount, currentAlarms, values }`, by id.
 */
function parseInstallations(body) {
  const records = Array.isArray(body?.records) ? body.records : [];
  const sites = [];
  for (const record of records) {
    const id = toNumber(record?.idSite);
    if (!Number.isInteger(id) || id <= 0 || sites.some((site) => site.id === id)) {
      continue;
    }
    const extended = Array.isArray(record.extended) ? record.extended : [];
    const last = toNumber(record.last_timestamp);
    const count = toNumber(record.num_alarms);
    sites.push({
      id,
      name: toText(record.name) ?? `VRM ${id}`,
      identifier: toText(record.identifier, 40),
      timezone: toText(record.timezone, 64),
      hasMains: toNumber(record.hasMains) === 1,
      hasGenerator: toNumber(record.hasGenerator) === 1,
      pvMax: toNumber(record.pvMax),
      lastAt: last && last > 0 ? last * 1000 : null,
      alarm: record.alarm === true,
      alarmCount: Number.isInteger(count) && count >= 0 ? count : null,
      currentAlarms: (Array.isArray(record.current_alarms) ? record.current_alarms : [])
        .map((alarm) => toText(typeof alarm === 'string' ? alarm : alarm?.description, 200))
        .filter(Boolean)
        .slice(0, 20),
      values: parseValues(extended),
    });
  }
  return sites.sort((a, b) => a.id - b.id);
}

const FLOWS = ['Pc', 'Pb', 'Pg', 'Bc', 'Bg', 'Gc', 'Gb', 'gc', 'gb'];

/**
 * @description The energies of a set of flows (kWh), null when VRM has none.
 * @param {object} flows - `{ Pc: kWh, … }` (absent = 0 when another is known).
 * @returns {object|null} `{ solar, consumption, gridImport, gridExport, charge,
 * discharge, generator, fromGrid }`.
 */
function energiesOf(flows) {
  const known = FLOWS.filter((code) => Number.isFinite(flows[code]));
  if (!known.length) {
    return null;
  }
  const v = (code) => Math.max(0, flows[code] ?? 0);
  return {
    solar: v('Pc') + v('Pb') + v('Pg'),
    consumption: v('Pc') + v('Bc') + v('Gc') + v('gc'),
    gridImport: v('Gc') + v('Gb'),
    gridExport: v('Pg') + v('Bg'),
    charge: v('Pb') + v('Gb') + v('gb'),
    discharge: v('Bc') + v('Bg'),
    generator: v('gc') + v('gb'),
    fromGrid: v('Gc'),
  };
}

/**
 * @description The self-sufficiency of a day: the share of the consumption not
 * taken from the grid.
 * @param {object|null} energies - energiesOf().
 * @returns {number|null} Percent.
 */
function selfSufficiency(energies) {
  if (!energies || !(energies.consumption > 0)) {
    return null;
  }
  return Math.min(100, Math.max(0, (1 - energies.fromGrid / energies.consumption) * 100));
}

/**
 * @description The energies of a stats?type=kwh answer: the totals and each hour.
 * @param {object} body - The answer.
 * @returns {{ totals: object|null, hours: object[] }} energiesOf() of the
 * period, and `{ at, solar, consumption }` per point.
 */
function parseKwh(body) {
  const totals = {};
  for (const code of FLOWS) {
    const value = toNumber(body?.totals?.[code]);
    if (value !== null) totals[code] = value;
  }
  const byTime = new Map();
  for (const code of FLOWS) {
    const points = body?.records?.[code];
    if (!Array.isArray(points)) continue;
    for (const point of points) {
      const at = toNumber(point?.[0]);
      const value = toNumber(point?.[1]);
      if (at === null || value === null) continue;
      const flows = byTime.get(at) ?? {};
      flows[code] = value;
      byTime.set(at, flows);
    }
  }
  const hours = [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([at, flows]) => {
      const energies = energiesOf(flows);
      return { at, solar: energies.solar, consumption: energies.consumption };
    });
  return { totals: energiesOf(totals), hours };
}

/**
 * @description The points of a forecast series: [[ms, Wh], …].
 * @param {unknown} series - The series (or false).
 * @returns {Array<[number, number]>|null} The points, null when none.
 */
function forecastPoints(series) {
  if (!Array.isArray(series)) {
    return null;
  }
  const points = series
    .map((point) => [toNumber(point?.[0]), toNumber(point?.[1])])
    .filter(([at, value]) => at !== null && value !== null)
    .map(([at, value]) => [at, Math.max(0, value)])
    .sort((a, b) => a[0] - b[0]);
  return points.length ? points : null;
}

/**
 * @description The forecasts of a stats?type=forecast answer.
 * @param {object} body - The answer.
 * @returns {{ solar: Array|null, consumption: Array|null }} [ms, Wh] per hour.
 */
function parseForecast(body) {
  return {
    solar: forecastPoints(body?.records?.solar_yield_forecast),
    consumption: forecastPoints(body?.records?.vrm_consumption_fc),
  };
}

/**
 * @description The entries of an alarm-log answer, active first.
 * @param {object} body - The answer.
 * @returns {object[]} `{ id, description, device, instance, started, cleared, active }`.
 */
function parseAlarmLog(body) {
  const records = Array.isArray(body?.records) ? body.records : [];
  const alarms = [];
  for (const record of records) {
    const id = toNumber(record?.idAlarm);
    const started = toNumber(record?.started);
    if (id === null || alarms.some((alarm) => alarm.id === id)) {
      continue;
    }
    const cleared = toNumber(record.cleared);
    const active = toNumber(record.isActive) === 1 || (record.isActive === undefined && !cleared);
    alarms.push({
      id,
      description: toText(record.description, 200) ?? toText(record.nameEnum, 200) ?? `Alarm ${id}`,
      device: toText(record.customName) ?? toText(record.device),
      instance: toNumber(record.instance),
      started: started ? started * 1000 : null,
      cleared: active || !cleared ? null : cleared * 1000,
      active,
    });
  }
  return alarms
    .sort((a, b) => Number(b.active) - Number(a.active) || (b.started ?? 0) - (a.started ?? 0))
    .slice(0, 50);
}

export {
  FLOWS,
  toNumber,
  toText,
  parseMe,
  parseValues,
  parseInstallations,
  energiesOf,
  selfSufficiency,
  parseKwh,
  parseForecast,
  parseAlarmLog,
};
