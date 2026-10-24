// A fake VRM API v2 for the tests: a real HTTP server on 127.0.0.1, with the
// endpoints, answers and refusals the VRM documentation describes, in the
// shapes the live API gave on the public demo account (2026-10-24). Tests
// never touch the network. Nothing starts on import (`node --test` also runs
// this file).
//
//   - authentication: `x-authorization: Token <TOKEN>`; anything else answers
//     HTTP 401 `{"success":false,"errors":"Invalid accesstoken
//     received","error_code":"invalid_token"}` (the live answer to a wrong
//     token, checked on 2026-10-24);
//   - users/me → user 4242; users/4242/installations?extended=1 → two
//     installations: 101 "Home ESS" (grid, solar, battery) and 202 "Sailboat"
//     (shore power, battery, no solar); another user id answers 403;
//   - installations/{id}/stats?type=kwh / type=forecast, alarm-log (an empty
//     log answers HTTP 200 `success: false`, `no_results_found`, as documented);
//   - `fake.refuse(prefix, status, { times, headers, body })` answers an error
//     instead (429 with Retry-After, 403, 500…).
// Never real data: a made-up autumn day.

import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOW = Date.parse('2026-10-24T12:00:00Z'); // 14:00 in Paris, a Saturday
const TZ = 'Europe/Paris';
// Not shaped like a real token: the push protection of GitHub must never
// mistake it for one.
const TOKEN = 'not-a-real-vrm-token';
const USER_ID = 4242;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const HOME = 101;
const BOAT = 202;
const MIDNIGHT = Date.parse('2026-10-23T22:00:00Z'); // 00:00 in Paris
const silent = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * @description A temporary folder standing for /data.
 * @returns {string} The path.
 */
const dataDir = () => mkdtempSync(join(tmpdir(), 'victron-vrm-'));

/**
 * @description An `extended` entry as VRM gives it.
 * @param {string} code - The code.
 * @param {number|null} rawValue - The value.
 * @param {string} [textValue] - The text of an enum.
 * @returns {object} The entry.
 */
const entry = (code, rawValue, textValue = null) => ({
  idDataAttribute: null,
  code,
  description: code,
  formatWithUnit: '%s',
  rawValue,
  formattedValue: rawValue === null ? '' : String(rawValue),
  textValue,
  dataAttributes: [],
});

/**
 * @description The solar power of a made-up autumn day at an instant.
 * @param {number} at - ms.
 * @param {number} peak - Watts at noon.
 * @returns {number} Watts.
 */
function solarAt(at, peak) {
  const start = MIDNIGHT + 8 * HOUR;
  const end = MIDNIGHT + 18 * HOUR;
  if (at <= start || at >= end) return 0;
  return peak * Math.sin((Math.PI * (at - start)) / (end - start));
}

/**
 * @description Start the fake VRM.
 * @param {object} [options] - `{ now }`: `() => number`, the clock of the test.
 * @returns {Promise<object>} `{ url, calls, sites, alarms, refuse, close, … }`.
 */
async function startFakeVrm({ now = () => NOW } = {}) {
  const calls = [];
  const refusals = [];
  // What the installations say; a test changes them.
  const sites = {
    [HOME]: {
      name: 'Home ESS',
      identifier: 'c0ffee000101',
      timezone: TZ,
      hasMains: 1,
      hasGenerator: 0,
      pvMax: 6000,
      lastAgo: 4 * MINUTE,
      alarm: false,
      num_alarms: 0,
      current_alarms: [],
      values: {
        bs: 72,
        bv: 52.4,
        bc: -8.5,
        bst: 2,
        ss: 'Inverting',
        Agl: 0,
        consumption: 640,
        solar_yield: 1850.4,
        from_to_grid: -210,
        generator: null,
      },
    },
    [BOAT]: {
      name: 'Sailboat',
      identifier: 'c0ffee000202',
      timezone: TZ,
      hasMains: 1,
      hasGenerator: 0,
      pvMax: 0,
      lastAgo: 6 * MINUTE,
      alarm: false,
      num_alarms: 0,
      current_alarms: [],
      values: {
        bs: 88,
        bv: 13.31,
        bc: 4.2,
        bst: 1,
        ss: 'Absorption',
        Agl: 0,
        consumption: 95,
        solar_yield: null,
        from_to_grid: null,
        generator: null,
      },
    },
  };
  const alarms = { [HOME]: [], [BOAT]: [] };
  const forecastAvailable = { [HOME]: true, [BOAT]: false };

  /**
   * @description One installation record, as users/{id}/installations?extended=1 gives it.
   * @param {number} id - The idSite.
   * @returns {object} The record.
   */
  function record(id) {
    const site = sites[id];
    const v = site.values;
    return {
      idSite: id,
      accessLevel: 1,
      owner: true,
      is_admin: true,
      name: site.name,
      identifier: site.identifier,
      idUser: USER_ID,
      pvMax: site.pvMax,
      timezone: site.timezone,
      phonenumber: null,
      notes: null,
      geofence: null,
      geofenceEnabled: false,
      realtimeUpdates: true,
      restrictNodeRed: false,
      hasMains: site.hasMains,
      hasGenerator: site.hasGenerator,
      noDataAlarmTimeout: null,
      alarmMonitoring: 1,
      invalidVRMAuthTokenUsedInLogRequest: 0,
      syscreated: 1664953641,
      shared: false,
      device_icon: 'battery',
      alarm: site.alarm,
      last_timestamp: site.lastAgo === null ? 0 : Math.floor((now() - site.lastAgo) / 1000),
      current_time: '14:00',
      timezone_offset: 7200,
      demo_mode: false,
      current_alarms: site.current_alarms,
      num_alarms: site.num_alarms,
      extended: [
        entry('v', 'v3.85'),
        entry('S', 9, 'Inverting'),
        entry('bv', v.bv),
        entry('bs', v.bs),
        entry('bc', v.bc),
        entry('bst', v.bst, ['idle', 'charging', 'discharging'][v.bst] ?? null),
        entry('si1', 1, 'Grid'),
        entry('ss', 9, v.ss),
        entry('consumption', v.consumption),
        entry('solar_yield', v.solar_yield),
        entry('from_to_grid', v.from_to_grid),
        entry('generator', v.generator),
        entry('ac_in', null),
        entry('ac_out', null),
        entry('s', 3, 'On'),
        entry('Agl', v.Agl, v.Agl ? 'Grid lost' : 'Grid ok'),
        entry('soc_status', 25, 'Discharging'),
      ],
    };
  }

  /**
   * @description The energy flows of an hour of the made-up day, kWh.
   * @param {number} id - The idSite.
   * @param {number} at - Start of the hour (ms).
   * @returns {object} `{ Pc, Pb, … }`, the flows with energy only.
   */
  function flowsAt(id, at) {
    if (id === BOAT) {
      return { Bc: 0.09, Gc: 0.01 };
    }
    const solar = solarAt(at + HOUR / 2, 2400) / 1000;
    const load = 0.45 + (((at - MIDNIGHT) / HOUR) % 5) * 0.05;
    const flows = {};
    if (solar > 0) {
      flows.Pc = Math.min(solar, load);
      const extra = solar - flows.Pc;
      if (extra > 0) {
        flows.Pb = extra * 0.6;
        flows.Pg = extra * 0.4;
      }
    }
    const missing = load - (flows.Pc ?? 0);
    if (missing > 0) {
      flows.Bc = missing * 0.7;
      flows.Gc = missing * 0.3;
    }
    return flows;
  }

  /**
   * @description stats?type=kwh between two instants, per hour.
   * @param {number} id - The idSite.
   * @param {number} start - Seconds.
   * @param {number} end - Seconds.
   * @returns {object} The answer.
   */
  function kwh(id, start, end) {
    const records = {};
    const totals = {};
    for (let at = Math.floor((start * 1000) / HOUR) * HOUR; at < end * 1000; at += HOUR) {
      for (const [code, value] of Object.entries(flowsAt(id, at))) {
        (records[code] ??= []).push([at, value]);
        totals[code] = (totals[code] ?? 0) + value;
      }
    }
    if (!Object.keys(totals).length) {
      return { success: true, records: { kwh: false }, totals: { kwh: false } };
    }
    totals.kwh = Object.values(totals).reduce((sum, value) => sum + value, 0);
    return { success: true, records, totals };
  }

  /**
   * @description stats?type=forecast between two instants, per hour (Wh).
   * @param {number} id - The idSite.
   * @param {number} start - Seconds.
   * @param {number} end - Seconds.
   * @returns {object} The answer.
   */
  function forecast(id, start, end) {
    if (!forecastAvailable[id]) {
      return {
        success: true,
        records: { solar_yield_forecast: false, vrm_consumption_fc: false },
        totals: { solar_yield_forecast: false, vrm_consumption_fc: false },
      };
    }
    const solar = [];
    const consumption = [];
    for (let at = start * 1000; at < end * 1000; at += HOUR) {
      // Tomorrow is sunnier.
      const peak = at >= MIDNIGHT + 24 * HOUR ? 3400 : 2500;
      solar.push([
        at,
        Math.round(solarAt(((at - MIDNIGHT) % (24 * HOUR)) + MIDNIGHT + HOUR / 2, peak)),
      ]);
      consumption.push([at, 450]);
    }
    const sum = (points) => points.reduce((total, [, value]) => total + value, 0);
    return {
      success: true,
      records: {
        solar_yield_forecast: solar,
        vrm_consumption_fc: consumption,
        vrm_consumption_fc_adj: false,
      },
      totals: {
        solar_yield_forecast: sum(solar),
        vrm_consumption_fc: sum(consumption),
        vrm_consumption_fc_adj: false,
      },
    };
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname.replace(/^\/v2\//, '');
    const query = Object.fromEntries(url.searchParams);
    const auth = req.headers['x-authorization'] ?? null;
    calls.push({ path, query, auth, userAgent: req.headers['user-agent'], method: req.method });
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') {
      send(405, { success: false, errors: 'Method not allowed', error_code: null });
      return;
    }
    if (auth !== `Token ${TOKEN}`) {
      send(401, {
        success: false,
        errors: 'Invalid accesstoken received',
        error_code: 'invalid_token',
      });
      return;
    }
    const refusal = refusals.find((item) => path.startsWith(item.prefix) && item.times > 0);
    if (refusal) {
      refusal.times -= 1;
      send(
        refusal.status,
        refusal.body ?? { success: false, errors: 'Refused', error_code: refusal.code ?? null },
        refusal.headers,
      );
      return;
    }
    if (path === 'users/me') {
      send(200, {
        success: true,
        user: { id: USER_ID, name: 'Test User', email: 'test@example.invalid', country: 'France' },
      });
      return;
    }
    let match = /^users\/(\d+)\/installations$/.exec(path);
    if (match) {
      if (Number(match[1]) !== USER_ID) {
        send(403, {
          success: false,
          errors: "You don't have sufficient rights to perform this action.",
          error_code: 'forbidden',
        });
        return;
      }
      send(200, { success: true, records: Object.keys(sites).map((id) => record(Number(id))) });
      return;
    }
    match = /^installations\/(\d+)\/(stats|alarm-log)$/.exec(path);
    const id = match ? Number(match[1]) : null;
    if (!match || !sites[id]) {
      send(404, { success: false, errors: 'Not found', error_code: 'not_found' });
      return;
    }
    if (match[2] === 'alarm-log') {
      const list = alarms[id].slice(0, Number(query.count ?? 3000));
      if (!list.length) {
        send(200, {
          success: false,
          error_code: 'no_results_found',
          errors: ['No alarm log found.'],
        });
        return;
      }
      send(200, { success: true, records: list, num_records: alarms[id].length });
      return;
    }
    const start = Number(query.start ?? Math.floor(now() / 1000) - 86400);
    const end = Number(query.end ?? Math.floor(now() / 1000));
    if (query.type === 'kwh') {
      send(200, kwh(id, start, end));
    } else if (query.type === 'forecast') {
      send(200, forecast(id, start, end));
    } else {
      send(400, { success: false, errors: 'Unknown type', error_code: 'invalid_type' });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/v2`,
    calls,
    sites,
    alarms,
    forecastAvailable,
    /**
     * @description Answer an error instead, for the paths starting with a prefix.
     * @param {string} prefix - "users/me", "installations/101/alarm-log"…
     * @param {number} status - The HTTP status.
     * @param {object} [options] - `{ times, headers, body, code }`.
     */
    refuse(prefix, status, { times = 1, headers = {}, body, code } = {}) {
      refusals.push({ prefix, status, times, headers, body, code });
    },
    /**
     * @description An alarm-log record as VRM gives it.
     * @param {object} alarm - `{ id, description, device, started, cleared }` (ms).
     * @returns {object} The record.
     */
    alarmRecord: ({
      id,
      description,
      device = 'Multi',
      started,
      cleared = null,
      instance = 276,
    }) => ({
      idAlarm: id,
      idSite: HOME,
      instance,
      type: 2,
      description,
      started: Math.floor(started / 1000),
      cleared: cleared === null ? null : Math.floor(cleared / 1000),
      idDataAttribute: 630,
      isActive: cleared === null ? 1 : 0,
      device,
      customName: null,
      nameEnum: 'Alarm',
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export {
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
  MIDNIGHT,
};
