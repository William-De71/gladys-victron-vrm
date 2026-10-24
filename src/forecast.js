// -----------------------------------------------------------------------------
// The VRM forecasts of an installation (stats?type=forecast, interval=hours):
// the solar yield and the consumption expected per hour, in Wh, for today and
// the next days. VRM computes them from the weather and the history of the
// installation; this module only adds them up per local day of the
// installation (its timezone) and keeps the hours a chart shows.
// -----------------------------------------------------------------------------

import { HOUR_MS, localParts, toInstant, addDays } from './time.js';

/**
 * @description The bounds of a local day.
 * @param {string} date - "2026-10-24".
 * @param {string} timeZone - The timezone of the installation.
 * @returns {[number, number]} Start (included), end (excluded), in ms.
 */
function dayBounds(date, timeZone) {
  return [toInstant(date, '00:00', timeZone), toInstant(addDays(date, 1), '00:00', timeZone)];
}

/**
 * @description The energy of a series between two instants, kWh. The hour that
 * holds `from` counts for its part after `from`.
 * @param {Array<[number, number]>|null} points - [ms, Wh] per hour.
 * @param {number} from - Start (ms).
 * @param {number} to - End (ms).
 * @returns {number|null} kWh, null without a point in the range.
 */
function energyBetween(points, from, to) {
  if (!Array.isArray(points)) {
    return null;
  }
  let total = 0;
  let found = false;
  for (const [at, wh] of points) {
    const end = at + HOUR_MS;
    if (end <= from || at >= to) continue;
    const share = (Math.min(end, to) - Math.max(at, from)) / HOUR_MS;
    total += wh * share;
    found = true;
  }
  return found ? total / 1000 : null;
}

/**
 * @description The totals of a forecast for today and tomorrow.
 * @param {object|null} forecast - `{ solar, consumption }` (parseForecast()).
 * @param {object} options - `{ now, timeZone }` (the timezone of the installation).
 * @returns {object} `{ solarToday, solarRemaining, solarTomorrow,
 * consumptionToday, consumptionTomorrow }`, kWh or null.
 */
function forecastSummary(forecast, { now, timeZone }) {
  const today = localParts(now, timeZone).date;
  const [start, end] = dayBounds(today, timeZone);
  const [, endTomorrow] = dayBounds(addDays(today, 1), timeZone);
  const solar = forecast?.solar ?? null;
  const consumption = forecast?.consumption ?? null;
  return {
    solarToday: energyBetween(solar, start, end),
    solarRemaining: energyBetween(solar, Math.max(now, start), end),
    solarTomorrow: energyBetween(solar, end, endTomorrow),
    consumptionToday: energyBetween(consumption, start, end),
    consumptionTomorrow: energyBetween(consumption, end, endTomorrow),
  };
}

/**
 * @description The hours of a forecast a chart shows: from the start of today to
 * the end of tomorrow.
 * @param {Array<[number, number]>|null} points - [ms, Wh] per hour.
 * @param {object} options - `{ now, timeZone }`.
 * @returns {Array<[number, number]>} The points.
 */
function chartHours(points, { now, timeZone }) {
  if (!Array.isArray(points)) {
    return [];
  }
  const today = localParts(now, timeZone).date;
  const [start] = dayBounds(today, timeZone);
  const [, end] = dayBounds(addDays(today, 1), timeZone);
  return points.filter(([at]) => at >= start && at < end);
}

export { dayBounds, energyBetween, forecastSummary, chartHours };
