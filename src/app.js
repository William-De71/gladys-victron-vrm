// -----------------------------------------------------------------------------
// The Victron VRM integration: every handler, registered on a Gladys client.
//
// Brings the Victron Energy installations of a VRM account (personal access
// token) into Gladys, through the official VRM API v2, read only:
//   - devices (device.js): one per installation — battery level, charge /
//     discharge power and voltage, solar power and energy of the day, signed
//     grid power, AC loads and consumption of the day, generator power;
//   - scene triggers (events.js): VRM alarm raised / cleared, battery low /
//     full, grid lost / restored, installation offline / online, access
//     refused;
//   - scene actions: the energies of today, the solar and consumption
//     forecasts;
//   - dashboard widgets (widgets.js): energy flow now, today, forecast, alarms;
//   - configuration buttons: test the connection, diagnostic.
//
// The integration reads the cloud on its own timer, one request at a time
// (vrm-api.js): every installation of the account in one request at the
// interval of the configuration (5 minutes by default: VRM itself receives the
// data every 1 to 15 minutes), the energies of today of each installation
// every 15 minutes, its alarm log every 30 minutes or as soon as VRM shows an
// alarm change, its forecast every hour. Never on a Gladys poll, never from a
// widget, never twice at startup (the times are kept in /data).
//
// index.js only creates the SDK client; the tests drive this module with the
// fake Gladys of the SDK and a fake VRM (test/helpers/fake-vrm.js).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  normalizeConfig,
  readLanguage,
  guessLanguage,
  INTERNAL_KEYS,
  AUTO_LANGUAGE,
} from './config.js';
import { createVrmClient, ACCOUNT_KINDS } from './vrm-api.js';
import { createStore } from './store.js';
import { parseMe, parseInstallations, parseKwh, parseForecast, parseAlarmLog } from './parse.js';
import {
  siteIds,
  siteOfExternalId,
  buildSiteDevice,
  buildSiteStates,
  liveValues,
  partsOf,
} from './device.js';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  TODAY_OUTPUTS,
  FORECAST_OUTPUTS,
  pick,
  detectBattery,
  detectGrid,
  detectOffline,
  detectAlarms,
  siteData,
  alarmData,
  rounded,
} from './events.js';
import {
  WIDGETS,
  messageContent,
  todayEnergies,
  buildLiveWidget,
  buildTodayWidget,
  buildForecastWidget,
  buildAlarmsWidget,
} from './widgets.js';
import { forecastSummary } from './forecast.js';
import {
  MINUTE_MS,
  HOUR_MS,
  defaultTimeZone,
  usableTimeZone,
  isTimeZone,
  localParts,
  toInstant,
  addDays,
} from './time.js';
import { t, all, ago, formatNumber, LANGUAGES } from './i18n.js';

const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  DIAGNOSTIC: 'diagnostic',
};
const TICK_MS = 15 * 1000;
// No burst at startup: the first readings wait a little, even when due.
const STARTUP_DELAY_MS = 10 * 1000;
const SITES_RETRY_MS = 2 * MINUTE_MS;
const TODAY_EVERY_MS = 15 * MINUTE_MS;
const ALARMS_EVERY_MS = 30 * MINUTE_MS;
const FORECAST_EVERY_MS = HOUR_MS;
const FORECAST_NONE_EVERY_MS = 6 * HOUR_MS;
const REFUSED_RETRY_MS = 24 * HOUR_MS;
const FAILED_RETRY_MS = 5 * MINUTE_MS;
const ACCESS_RETRY_MS = 15 * MINUTE_MS;
const ME_EVERY_MS = 24 * HOUR_MS;
const ALARM_LOG_COUNT = 25;
const DIAGNOSTIC_CHUNK = 3000;
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const USER_AGENT = `gladys-victron-vrm/${VERSION} (+https://github.com/William-De71/gladys-victron-vrm)`;

/**
 * @description A short fingerprint of the token, to notice it changed (the
 * token itself is never stored).
 * @param {string} token - The token.
 * @returns {string|null} 16 hexadecimal characters.
 */
const tokenHash = (token) =>
  token ? createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16) : null;

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {Function} [options.fetch] - HTTP transport of VRM (tests).
 * @param {string} [options.baseUrl] - The API root (tests).
 * @param {string} [options.dataDir] - The writable folder (/data).
 * @param {Function} [options.now] - `() => number` in ms (tests).
 * @param {string} [options.timeZone] - IANA timezone of Gladys (TZ by default).
 * @param {boolean} [options.timers] - Arm the reading timer (false in tests).
 * @param {number} [options.spacingMs] - Time between two requests (0 in tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    fetch: fetchFn,
    baseUrl,
    dataDir,
    now = () => Date.now(),
    timeZone: zone = defaultTimeZone(),
    timers = true,
    spacingMs,
    logger = sdkLogger,
  } = {},
) {
  const timeZone = usableTimeZone(zone);
  let config = normalizeConfig();
  let language = guessLanguage(timeZone);
  let createdDevices = new Set();
  let lastStatus = null;
  let lastDiscovery = null;
  let lastAccessTry = 0;
  let timer = null;
  let startTimer = null;
  let running = null;
  let stopped = false;

  const store = createStore({ ...(dataDir ? { dir: dataDir } : {}), logger });
  const api = createVrmClient({
    getToken: () => config.token,
    userAgent: USER_AGENT,
    now,
    ...(fetchFn ? { fetch: fetchFn } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(Number.isFinite(spacingMs) ? { spacingMs } : {}),
  });

  /**
   * @description Remember the language of a widget request, and store it when it changed.
   * @param {string} next - The language.
   */
  function rememberLanguage(next) {
    if (!LANGUAGES.includes(next) || next === language) {
      return;
    }
    language = next;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: next })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
  }

  /**
   * @description Language of the texts Gladys does not ask for in a language.
   * @returns {string} The language.
   */
  const textLanguage = () => (config.language === AUTO_LANGUAGE ? language : config.language);

  const offlineMs = () => config.offlineMinutes * MINUTE_MS;
  const pollMs = () => config.pollSeconds * 1000;

  // --- What is known of an installation ---------------------------------------------

  /**
   * @description The installations known.
   * @returns {object[]} The installations.
   */
  const sites = () => store.data.sites;

  /**
   * @description An installation by id.
   * @param {number} id - The idSite.
   * @returns {object|undefined} The installation.
   */
  const siteOf = (id) => sites().find((site) => site.id === id);

  /**
   * @description What is kept of an installation.
   * @param {number} id - The idSite.
   * @returns {object} The state (store.js).
   */
  function stateOf(id) {
    store.data.states[id] ??= {};
    const state = store.data.states[id];
    state.today ??= null;
    state.forecast ??= null;
    state.alarms ??= null;
    state.at ??= {};
    state.seen ??= {};
    return state;
  }

  /**
   * @description The timezone of an installation (its days), else the one of Gladys.
   * @param {object} [site] - The installation.
   * @returns {string} An IANA name.
   */
  const zoneOf = (site) => (isTimeZone(site?.timezone) ? site.timezone : timeZone);

  /**
   * @description Today in the timezone of an installation.
   * @param {object} site - The installation.
   * @returns {string} "2026-10-24".
   */
  const dayOf = (site) => localParts(now(), zoneOf(site)).date;

  /**
   * @description Whether VRM received data from an installation lately.
   * @param {object} [site] - The installation.
   * @returns {boolean} True when fresh.
   */
  const freshOf = (site) => Number.isFinite(site?.lastAt) && now() - site.lastAt <= offlineMs();

  /**
   * @description The view of an installation the widgets, the scenes and the states use.
   * @param {number} id - The idSite.
   * @returns {object} The view.
   */
  function viewOf(id) {
    const site = siteOf(id) ?? { id, name: `VRM ${id}` };
    const state = stateOf(id);
    const date = dayOf(site);
    return {
      id,
      deviceId: siteIds(gladys, id).device,
      name: buildSiteDevice(gladys, site).name,
      identifier: site.identifier ?? null,
      timezone: zoneOf(site),
      parts: site.parts ?? {},
      values: site.values ?? null,
      lastAt: site.lastAt ?? null,
      fresh: freshOf(site),
      offline: Number.isFinite(site.lastAt) && !freshOf(site),
      lowLevel: config.lowLevel,
      alarmCount: Number.isInteger(site.alarmCount) ? site.alarmCount : null,
      alarms: state.alarms,
      alarmsAt: state.at.alarmsRead ?? null,
      alarmsRefused: state.alarmsRefused === true,
      today: state.today?.date === date ? state.today : null,
      forecast: state.forecast,
      forecastRefused: state.forecastRefused === true,
    };
  }

  /**
   * @description The values of the features of an installation now.
   * @param {number} id - The idSite.
   * @returns {object} `{ battery_level, … }`, null when unknown.
   */
  function valuesOf(id) {
    const view = viewOf(id);
    return {
      ...liveValues(view.fresh ? view.values : null),
      pv_today: view.today?.totals?.solar ?? null,
      load_today: view.today?.totals?.consumption ?? null,
    };
  }

  // --- Errors and status -------------------------------------------------------------

  /**
   * @description The message of an error, for a user.
   * @param {Error} err - The error.
   * @param {string} lang - The language.
   * @returns {string} The message.
   */
  function errorText(err, lang) {
    const key = {
      auth: 'errAuth',
      forbidden: 'errForbidden',
      rate_limit: 'errRateLimit',
      server: 'errServer',
      unreachable: 'errUnreachable',
    }[err?.kind];
    if (key) {
      return t(key, lang);
    }
    return t('errFailed', lang, { detail: String(err?.message ?? '').slice(0, 120) });
  }

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} connected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(connected, message) {
    const clipped = Object.fromEntries(
      Object.entries(message).map(([lang, text]) => [lang, text.slice(0, 200)]),
    );
    const signature = JSON.stringify([connected, clipped]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, clipped);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description Work out the connection status.
   * @returns {Promise<void>}
   */
  async function refreshStatus() {
    if (!config.token) {
      await reportStatus(false, all('statusNoToken'));
      return;
    }
    if (store.data.accessRefused) {
      await reportStatus(
        false,
        all((lang) => errorText(store.data.accessRefused, lang)),
      );
      return;
    }
    if (!store.data.sitesAt) {
      await reportStatus(true, all('statusWaiting'));
      return;
    }
    if (sites().length === 0) {
      await reportStatus(false, all('statusNoSite'));
      return;
    }
    const paused = api.pausedUntil();
    await reportStatus(
      true,
      all((lang) => {
        const lines = sites().map((site) => {
          const view = viewOf(site.id);
          if (view.offline) return t('siteLineOffline', lang, { name: site.name });
          const soc = view.fresh ? view.values?.soc : null;
          return t('siteLine', lang, {
            name: site.name,
            value: Number.isFinite(soc) ? `${formatNumber(soc, lang, 0)} %` : '',
          }).trim();
        });
        const parts = [t('statusOk', lang, { count: sites().length, sites: lines.join(', ') })];
        if (paused) parts.push(t('statusPaused', lang));
        return parts.join(' ');
      }),
    );
  }

  /**
   * @description Refresh the list of the devices the user created.
   * @returns {Promise<void>}
   */
  async function refreshCreatedDevices() {
    try {
      const devices = await gladys.getDevices();
      createdDevices = new Set(devices.map((device) => device.external_id));
    } catch (err) {
      logger.warn(`Unable to read the devices: ${err.message}`);
    }
  }

  /**
   * @description Ask the open widgets to pull their content again.
   */
  function refreshWidgets() {
    for (const key of Object.values(WIDGETS)) {
      Promise.resolve(gladys.requestWidgetRefresh(key)).catch(() => {});
    }
  }

  /**
   * @description Publish scene events, one by one.
   * @param {Array<{ key: string, data: object }>} events - The events.
   * @returns {Promise<void>}
   */
  async function publishEvents(events) {
    for (const { key, data } of events) {
      logger.info(`VRM: ${key}${data.site_id ? ` (${data.site_id})` : ''}`);
      try {
        await gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.warn(`Unable to fire ${key}: ${err.message}`);
      }
    }
  }

  // --- Devices -----------------------------------------------------------------------

  /**
   * @description Offer the devices of the known installations, when they changed.
   * @param {boolean} [force] - Publish even when unchanged.
   * @returns {Promise<number>} How many devices were offered.
   */
  async function publishDiscoveredDevices(force = false) {
    const lang = textLanguage();
    const devices = sites().map((site) => buildSiteDevice(gladys, site, lang));
    const signature = JSON.stringify(devices);
    if (force || signature !== lastDiscovery) {
      await gladys.publishDiscoveredDevices(devices);
      lastDiscovery = signature;
    }
    return devices.length;
  }

  /**
   * @description Publish the states of an installation, when its device exists.
   * @param {number} id - The idSite.
   * @returns {Promise<void>}
   */
  async function publishStates(id) {
    const site = siteOf(id);
    if (!site || !createdDevices.has(siteIds(gladys, id).device)) {
      return;
    }
    const states = buildSiteStates(gladys, site, valuesOf(id));
    if (states.length) {
      await gladys
        .publishChangedStates(states)
        .catch((err) => logger.warn(`Unable to publish the states of ${id}: ${err.message}`));
    }
  }

  // --- Reading -----------------------------------------------------------------------

  /**
   * @description What VRM shows of the alarms of an installation (a change asks
   * for the alarm log at once).
   * @param {object} site - The installation.
   * @returns {string} The signature.
   */
  const alarmSignature = (site) =>
    JSON.stringify([site.alarm, site.alarmCount, site.currentAlarms ?? []]);

  /**
   * @description The readings due for an installation, in order.
   * @param {number} id - The idSite.
   * @returns {string[]} The tasks.
   */
  function dueOf(id) {
    const site = siteOf(id);
    if (!site) {
      return [];
    }
    const state = stateOf(id);
    const since = (task) => now() - (state.at[task] ?? 0);
    const date = dayOf(site);
    const due = [];
    if (
      since('today') >= TODAY_EVERY_MS ||
      (state.today?.date !== date && since('today') >= MINUTE_MS)
    ) {
      due.push('today');
    }
    const alarmsEvery = state.alarmsRefused ? REFUSED_RETRY_MS : ALARMS_EVERY_MS;
    if (
      since('alarms') >= alarmsEvery ||
      (!state.alarmsRefused &&
        state.alarmSignature !== alarmSignature(site) &&
        since('alarms') >= MINUTE_MS)
    ) {
      due.push('alarms');
    }
    const empty = state.forecast && !state.forecast.solar && !state.forecast.consumption;
    const forecastEvery = state.forecastRefused
      ? REFUSED_RETRY_MS
      : empty
        ? FORECAST_NONE_EVERY_MS
        : FORECAST_EVERY_MS;
    if (
      since('forecast') >= forecastEvery ||
      (state.forecast && state.forecast.date !== date && since('forecast') >= MINUTE_MS)
    ) {
      due.push('forecast');
    }
    return due;
  }

  /**
   * @description Keep the installations read from VRM, and find the transitions.
   * @param {object[]} list - parseInstallations().
   * @param {Array} events - The scene events found (filled in).
   * @returns {boolean} True when the devices offered changed.
   */
  function applySites(list, events) {
    const before = JSON.stringify(
      sites().map(({ id, name, identifier, parts }) => [id, name, identifier, parts]),
    );
    store.data.sites = list.map((site) => {
      const known = siteOf(site.id);
      return { ...site, parts: partsOf(site, known?.parts), readAt: now() };
    });
    store.data.sitesAt = now();
    for (const id of Object.keys(store.data.states)) {
      if (!siteOf(Number(id))) {
        delete store.data.states[id];
      }
    }
    for (const site of sites()) {
      const state = stateOf(site.id);
      const view = () => viewOf(site.id);
      const offline = detectOffline(state.seen, {
        lastAt: site.lastAt,
        now: now(),
        offlineMs: offlineMs(),
      });
      state.seen = offline.next;
      for (const key of offline.events) {
        events.push({ key, data: siteData(view(), { minutes_without_data: offline.minutes }) });
      }
      if (!freshOf(site)) {
        continue;
      }
      const values = site.values ?? {};
      const battery = detectBattery(state.seen, values.soc, config.lowLevel);
      state.seen = battery.next;
      for (const key of battery.events) {
        events.push({
          key,
          data: siteData(view(), {
            battery_level: rounded(values.soc, 1),
            battery_voltage: rounded(values.voltage, 2),
            ...(key === TRIGGERS.BATTERY_LOW ? { low_level: config.lowLevel } : {}),
          }),
        });
      }
      const grid = detectGrid(state.seen, values.gridAlarm, now());
      state.seen = grid.next;
      for (const key of grid.events) {
        events.push({
          key,
          data: siteData(view(), {
            battery_level: rounded(values.soc, 1),
            ...(key === TRIGGERS.GRID_RESTORED ? { minutes_lost: grid.minutes } : {}),
          }),
        });
      }
    }
    const after = JSON.stringify(
      sites().map(({ id, name, identifier, parts }) => [id, name, identifier, parts]),
    );
    return after !== before;
  }

  /**
   * @description Run one reading of an installation.
   * @param {number} id - The idSite.
   * @param {string} task - The reading.
   * @param {Array} events - The scene events found (filled in).
   * @returns {Promise<void>}
   */
  async function read(id, task, events) {
    const site = siteOf(id);
    const state = stateOf(id);
    const zoneName = zoneOf(site);
    const date = dayOf(site);
    state.at[task] = now();
    try {
      if (task === 'today') {
        const start = toInstant(date, '00:00', zoneName);
        const answer = parseKwh(
          await api.stats(id, {
            type: 'kwh',
            interval: 'hours',
            start: Math.floor(start / 1000),
            end: Math.floor(now() / 1000),
          }),
        );
        state.today = {
          date,
          totals: answer.totals,
          hours: answer.hours.filter((hour) => hour.at >= start).slice(-48),
          at: now(),
        };
      } else if (task === 'forecast') {
        await readForecast(id);
      } else if (task === 'alarms') {
        const signature = alarmSignature(site);
        const alarms = parseAlarmLog(await api.alarmLog(id, ALARM_LOG_COUNT));
        const found = detectAlarms(state.seen, alarms);
        state.seen = found.next;
        state.alarms = alarms;
        state.alarmSignature = signature;
        state.alarmsRefused = false;
        state.at.alarmsRead = now();
        const view = viewOf(id);
        for (const alarm of found.raised) {
          events.push({ key: TRIGGERS.ALARM_RAISED, data: alarmData(view, alarm, now()) });
        }
        for (const alarm of found.cleared) {
          events.push({ key: TRIGGERS.ALARM_CLEARED, data: alarmData(view, alarm, now()) });
        }
      }
    } catch (err) {
      if (err.kind === 'forbidden' || err.kind === 'not_found') {
        if (task === 'alarms') state.alarmsRefused = true;
        if (task === 'forecast') state.forecastRefused = true;
        return;
      }
      if (!['rate_limit', ...ACCOUNT_KINDS].includes(err.kind)) {
        // Tried again in a few minutes, not at the next tick.
        state.at[task] =
          now() - (task === 'today' ? TODAY_EVERY_MS : ALARMS_EVERY_MS) + FAILED_RETRY_MS;
      }
      throw err;
    }
  }

  /**
   * @description Read the forecasts of an installation: today and the next two days.
   * @param {number} id - The idSite.
   * @returns {Promise<object>} The forecast kept.
   */
  async function readForecast(id) {
    const site = siteOf(id);
    const state = stateOf(id);
    const zoneName = zoneOf(site);
    const date = dayOf(site);
    const start = toInstant(date, '00:00', zoneName);
    const end = toInstant(addDays(date, 2), '00:00', zoneName);
    const forecast = parseForecast(
      await api.stats(id, {
        type: 'forecast',
        interval: 'hours',
        start: Math.floor(start / 1000),
        end: Math.floor(end / 1000),
      }),
    );
    state.forecast = { ...forecast, date, at: now() };
    state.forecastRefused = false;
    state.at.forecast = now();
    return state.forecast;
  }

  /**
   * @description Remember a refusal of the token, and fire the trigger once.
   * @param {Error} err - The error.
   * @param {Array} events - The scene events (filled in).
   */
  function refused(err, events) {
    const signature = `${err.kind}:${err.code ?? ''}`;
    if (store.data.accessRefused?.signature !== signature) {
      events.push({
        key: TRIGGERS.ACCESS_REFUSED,
        data: {
          reason: err.kind,
          code: err.code ?? null,
          message: errorText(err, textLanguage()).slice(0, 1000),
        },
      });
    }
    store.data.accessRefused = { kind: err.kind, code: err.code ?? null, signature };
    lastAccessTry = now();
  }

  /**
   * @description Note the error of a reading.
   * @param {string} what - The reading.
   * @param {Error} err - The error.
   */
  function noteError(what, err) {
    const kind = err.kind ?? 'failed';
    logger.warn(`VRM ${what} (${kind}): ${err.message}`);
    store.data.lastError = { kind, message: String(err.message).slice(0, 200), at: now() };
  }

  /**
   * @description Read the user and the installations of the token.
   * @param {Array} events - The scene events (filled in).
   * @returns {Promise<boolean>} True when the devices offered changed.
   */
  async function readSites(events) {
    store.data.sitesTriedAt = now();
    const hash = tokenHash(config.token);
    if (
      !store.data.userId ||
      store.data.tokenHash !== hash ||
      now() - (store.data.meAt ?? 0) >= ME_EVERY_MS
    ) {
      const userId = parseMe(await api.me());
      if (!userId) {
        throw Object.assign(new Error('users/me gave no user id'), { kind: 'failed' });
      }
      store.data.userId = userId;
      store.data.tokenHash = hash;
      store.data.meAt = now();
    }
    return applySites(parseInstallations(await api.installations(store.data.userId)), events);
  }

  /**
   * @description Read what is due, then publish what changed.
   * @returns {Promise<void>}
   */
  async function runReadings() {
    if (!config.token) {
      await refreshStatus();
      return;
    }
    if (store.data.accessRefused && now() - lastAccessTry < ACCESS_RETRY_MS) {
      await refreshStatus();
      return;
    }
    if (api.pausedUntil()) {
      await refreshStatus();
      return;
    }
    const events = [];
    let changed = false;
    let discovery = false;
    let stop = false;
    const sitesDue =
      store.data.accessRefused ||
      (now() - (store.data.sitesAt ?? 0) >= pollMs() &&
        now() - (store.data.sitesTriedAt ?? 0) >= Math.min(pollMs(), SITES_RETRY_MS));
    if (sitesDue) {
      lastAccessTry = now();
      try {
        discovery = await readSites(events);
        changed = true;
        if (store.data.accessRefused) {
          logger.info('VRM accepts the access token again');
          store.data.accessRefused = null;
        }
      } catch (err) {
        noteError('installations', err);
        // A 403 on the account itself (users/me, its installations) is a
        // refusal of the token too; on one installation it is not.
        if (ACCOUNT_KINDS.includes(err.kind) || err.kind === 'forbidden') {
          refused(err, events);
        }
        stop = true;
      }
    }
    if (!store.data.accessRefused && !stop) {
      for (const site of sites()) {
        if (stop) break;
        for (const task of dueOf(site.id)) {
          try {
            await read(site.id, task, events);
            changed = true;
          } catch (err) {
            noteError(`${task} of ${site.id}`, err);
            if (ACCOUNT_KINDS.includes(err.kind)) {
              refused(err, events);
            }
            if (['rate_limit', 'unreachable', ...ACCOUNT_KINDS].includes(err.kind)) {
              stop = true;
              break;
            }
          }
        }
      }
    }
    await store.save();
    await publishEvents(events);
    if (changed || discovery) {
      await publishDiscoveredDevices().catch((err) =>
        logger.warn(`Unable to offer the devices: ${err.message}`),
      );
      for (const site of sites()) {
        await publishStates(site.id);
      }
      refreshWidgets();
    }
    await refreshStatus();
  }

  /**
   * @description Run the readings (one round at a time).
   * @returns {Promise<void>}
   */
  function tick() {
    if (!running) {
      running = runReadings()
        .catch((err) => logger.error('Readings', err))
        .finally(() => {
          running = null;
        });
    }
    return running;
  }

  /**
   * @description (Re)arm the reading timer.
   */
  function schedule() {
    clearInterval(timer);
    clearTimeout(startTimer);
    if (!timers || stopped) {
      return;
    }
    startTimer = setTimeout(tick, STARTUP_DELAY_MS);
    startTimer.unref?.();
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
  }

  /**
   * @description Offer the devices, publish what is known, arm the timer.
   * @returns {Promise<void>}
   */
  async function applyConfig() {
    await store.save();
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    for (const site of sites()) {
      await publishStates(site.id);
    }
    await refreshStatus();
    schedule();
  }

  /**
   * @description The installation a widget or a scene action targets.
   * @param {unknown} externalId - The `source: "devices"` value.
   * @returns {number|null} The idSite, the first one by default.
   */
  function target(externalId) {
    const id = siteOfExternalId(externalId);
    if (id && siteOf(id)) {
      return id;
    }
    return sites()[0]?.id ?? null;
  }

  // --- Dashboard widgets -------------------------------------------------------------

  /**
   * @description The common start of a widget: the installation, or a message.
   * @param {object} settings - The widget settings.
   * @param {string} lang - The language.
   * @returns {{ id?: number, content?: object }} The installation, or the content to show.
   */
  function widgetSite(settings, lang) {
    if (!config.token) {
      return { content: messageContent(t('statusNoToken', lang)) };
    }
    if (store.data.accessRefused) {
      return { content: messageContent(errorText(store.data.accessRefused, lang)) };
    }
    const id = target(settings.installation);
    if (!id) {
      return {
        content: messageContent(t(store.data.sitesAt ? 'statusNoSite' : 'statusWaiting', lang)),
      };
    }
    return { id };
  }

  /**
   * @description A widget handler: the language remembered, the installation found.
   * @param {Function} build - `({ view, language, now, timeZone }) => content`.
   * @returns {Function} The handler.
   */
  const widget =
    (build) =>
    async ({ settings = {}, language: lang }) => {
      rememberLanguage(lang);
      const { id, content } = widgetSite(settings, lang);
      return content ?? build({ view: viewOf(id), language: lang, now: now(), timeZone });
    };

  gladys.onWidgetGet(WIDGETS.LIVE, widget(buildLiveWidget));
  gladys.onWidgetGet(WIDGETS.TODAY, widget(buildTodayWidget));
  gladys.onWidgetGet(WIDGETS.FORECAST, widget(buildForecastWidget));
  gladys.onWidgetGet(WIDGETS.ALARMS, widget(buildAlarmsWidget));

  // --- Scene actions -----------------------------------------------------------------

  /**
   * @description The installation of a scene action, checked.
   * @param {unknown} externalId - The `installation` field.
   * @param {string} lang - The language.
   * @returns {number} The idSite.
   */
  function actionTarget(externalId, lang) {
    if (!config.token) {
      throw new Error(t('statusNoToken', lang));
    }
    const id = target(externalId);
    if (!id) {
      throw new Error(t('statusNoSite', lang));
    }
    return id;
  }

  // Answers from what the timer read: the action never sends a request.
  gladys.onSceneAction(SCENE_ACTIONS.GET_TODAY, async (fields = {}) => {
    const lang = textLanguage();
    const id = actionTarget(fields.installation, lang);
    const view = viewOf(id);
    const energy = todayEnergies(view);
    const soc = view.fresh ? rounded(view.values?.soc, 1) : null;
    const kwh = (value) => rounded(value, 2);
    const text = (value) => (Number.isFinite(value) ? formatNumber(value, lang, 1) : '–');
    return pick(
      {
        solar_kwh: kwh(energy.solar),
        consumption_kwh: kwh(energy.consumption),
        import_kwh: kwh(energy.gridImport),
        export_kwh: kwh(energy.gridExport),
        charge_kwh: kwh(energy.charge),
        discharge_kwh: kwh(energy.discharge),
        generator_kwh: kwh(energy.generator),
        self_sufficiency: rounded(energy.selfSufficiency),
        battery_level: soc,
        summary: t('todaySummary', lang, {
          solar: text(energy.solar),
          consumption: text(energy.consumption),
          import: text(energy.gridImport),
          export: text(energy.gridExport),
          soc: Number.isFinite(soc) ? `${formatNumber(soc, lang, 0)} %` : '–',
        }).slice(0, 1000),
      },
      TODAY_OUTPUTS,
    );
  });

  // The forecast of the timer when it is less than an hour old, else read now.
  gladys.onSceneAction(SCENE_ACTIONS.GET_FORECAST, async (fields = {}) => {
    const lang = textLanguage();
    const id = actionTarget(fields.installation, lang);
    const site = siteOf(id);
    let forecast = stateOf(id).forecast;
    if (
      !forecast ||
      forecast.date !== dayOf(site) ||
      now() - (forecast.at ?? 0) >= FORECAST_EVERY_MS
    ) {
      try {
        forecast = await readForecast(id);
        await store.save();
      } catch (err) {
        logger.warn(`VRM refused a forecast (${err.kind ?? 'error'}): ${err.message}`);
        throw new Error(errorText(err, lang).slice(0, 500), { cause: err });
      }
    }
    if (!forecast.solar && !forecast.consumption) {
      throw new Error(t('errNoForecast', lang));
    }
    const summary = forecastSummary(forecast, { now: now(), timeZone: zoneOf(site) });
    const kwh = (value) => rounded(value, 2);
    const text = (value) => (Number.isFinite(value) ? formatNumber(value, lang, 1) : '–');
    return pick(
      {
        solar_today_kwh: kwh(summary.solarToday),
        solar_remaining_kwh: kwh(summary.solarRemaining),
        solar_tomorrow_kwh: kwh(summary.solarTomorrow),
        consumption_today_kwh: kwh(summary.consumptionToday),
        consumption_tomorrow_kwh: kwh(summary.consumptionTomorrow),
        summary: t('forecastSummary', lang, {
          today: text(summary.solarToday),
          left: text(summary.solarRemaining),
          tomorrow: text(summary.solarTomorrow),
          consumption: text(summary.consumptionTomorrow),
        }).slice(0, 1000),
      },
      FORECAST_OUTPUTS,
    );
  });

  // --- Configuration screen actions --------------------------------------------------

  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    if (!config.token) {
      return all('statusNoToken');
    }
    try {
      const me = await api.me();
      const userId = parseMe(me);
      if (!userId) {
        return all('errFailed', { detail: 'users/me' });
      }
      store.data.userId = userId;
      store.data.tokenHash = tokenHash(config.token);
      store.data.meAt = now();
      store.data.sitesTriedAt = now();
      const events = [];
      const changed = applySites(parseInstallations(await api.installations(userId)), events);
      store.data.accessRefused = null;
      await store.save();
      await publishEvents(events);
      if (changed) {
        await publishDiscoveredDevices().catch(() => {});
      }
      lastStatus = null;
      await refreshStatus();
      schedule();
      const user = String(me?.user?.name ?? me?.user?.email ?? userId).slice(0, 60);
      if (sites().length === 0) {
        return all('statusNoSite');
      }
      return all((lang) =>
        [
          t('testOk', lang, { user, count: sites().length }),
          ...sites().map((site) =>
            t('testLine', lang, {
              name: site.name,
              id: site.id,
              ago: ago(site.lastAt, now(), lang),
            }),
          ),
        ]
          .join(' · ')
          .slice(0, 1000),
      );
    } catch (err) {
      return all((lang) => errorText(err, lang));
    }
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    const iso = (value) => (value ? new Date(value).toISOString() : null);
    const report = {
      version: VERSION,
      timeZone,
      token: config.token ? 'set' : 'missing',
      pollSeconds: config.pollSeconds,
      lowLevel: config.lowLevel,
      offlineMinutes: config.offlineMinutes,
      language: config.language,
      userId: store.data.userId,
      accessRefused: store.data.accessRefused,
      lastError: store.data.lastError,
      sitesAt: iso(store.data.sitesAt),
      api: {
        requests: api.requests(),
        pausedUntil: iso(api.pausedUntil()),
        backlog: api.backlog(),
      },
      sites: sites().map((site) => {
        const state = stateOf(site.id);
        return {
          ...site,
          created: createdDevices.has(siteIds(gladys, site.id).device),
          lastAt: iso(site.lastAt),
          fresh: freshOf(site),
          today: state.today ? { ...state.today, hours: state.today.hours.length } : null,
          forecast: state.forecast
            ? {
                date: state.forecast.date,
                solar: state.forecast.solar?.length ?? 0,
                consumption: state.forecast.consumption?.length ?? 0,
              }
            : null,
          forecastRefused: state.forecastRefused ?? false,
          alarms: state.alarms,
          alarmsRefused: state.alarmsRefused ?? false,
          at: Object.fromEntries(Object.entries(state.at).map(([key, value]) => [key, iso(value)])),
          due: dueOf(site.id),
          seen: state.seen,
        };
      }),
    };
    const json = JSON.stringify(report);
    const count = Math.max(1, Math.ceil(json.length / DIAGNOSTIC_CHUNK));
    for (let chunk = 0; chunk < count; chunk += 1) {
      logger.info(
        `VRM diagnostic ${chunk + 1}/${count}: ${json.slice(chunk * DIAGNOSTIC_CHUNK, (chunk + 1) * DIAGNOSTIC_CHUNK)}`,
      );
    }
    return all('diagnosticDone', { count });
  });

  // --- Devices -----------------------------------------------------------------------
  gladys.onScanRequest(async () => {
    const count = await publishDiscoveredDevices(true);
    logger.info(`Scan: ${count} device(s) offered`);
    if (!count) {
      store.data.sitesAt = 0;
      store.data.sitesTriedAt = 0;
      tick();
    }
  });

  gladys.onDeviceCreated(async () => {
    await refreshCreatedDevices();
    // States sent before the device existed were dropped by Gladys, and the SDK
    // forgot what it sent for this device: send everything known again.
    for (const site of sites()) {
      await publishStates(site.id);
    }
    refreshWidgets();
  });

  gladys.onDeviceDeleted(refreshCreatedDevices);

  // --- Configuration -----------------------------------------------------------------

  /**
   * @description Reload the whole config (internal keys included).
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      const raw = await gladys.getConfig();
      config = normalizeConfig(raw);
      language = readLanguage(raw, language);
    } catch (err) {
      if (fallback) {
        config = normalizeConfig(fallback);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  gladys.onConfigUpdated(async (rawConfig) => {
    const previous = config.token;
    await loadConfig(rawConfig);
    logger.info('Configuration updated');
    lastStatus = null;
    lastDiscovery = null;
    if (config.token !== previous) {
      // A new token: tried at the next tick, the user and the list read again.
      store.data.accessRefused = null;
      store.data.userId = null;
      store.data.sitesAt = 0;
      store.data.sitesTriedAt = 0;
      lastAccessTry = 0;
    }
    await applyConfig();
  });

  // --- Connection lifecycle ----------------------------------------------------------
  // Each (re)connection resynchronizes; the promise lets the tests wait for it.
  let startup = Promise.resolve();
  gladys.on('connected', () => {
    startup = (async () => {
      await store.load();
      await loadConfig();
      await refreshCreatedDevices();
      lastStatus = null;
      lastDiscovery = null;
      await applyConfig();
    })().catch((err) => logger.error('Startup', err));
  });

  // --- Graceful shutdown -------------------------------------------------------------
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stopped = true;
    clearInterval(timer);
    clearTimeout(startTimer);
    await store.save();
  });

  return {
    store,
    api,
    tick,
    dueOf,
    viewOf,
    valuesOf,
    getConfig: () => config,
    whenReady: () => startup,
  };
}

export { createApp, ACTIONS, USER_AGENT, ACCESS_RETRY_MS };
