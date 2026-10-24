// The VRM forecasts added up per local day of the installation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayBounds, energyBetween, forecastSummary, chartHours } from '../src/forecast.js';

const HOUR = 60 * 60 * 1000;
const ZONE = 'Europe/Paris';
const MIDNIGHT = Date.parse('2026-10-23T22:00:00Z'); // 2026-10-24 00:00 in Paris
// Two days of hours from midnight: 1 kWh of sun per hour from 10:00 to 16:00
// today, 2 kWh tomorrow; 500 Wh of consumption every hour.
const solar = Array.from({ length: 48 }, (_, i) => {
  const hour = i % 24;
  const sunny = hour >= 10 && hour < 16;
  return [MIDNIGHT + i * HOUR, sunny ? (i < 24 ? 1000 : 2000) : 0];
});
const consumption = Array.from({ length: 48 }, (_, i) => [MIDNIGHT + i * HOUR, 500]);

test('the bounds of a local day, around a change of time', () => {
  assert.deepEqual(dayBounds('2026-10-24', ZONE), [MIDNIGHT, MIDNIGHT + 24 * HOUR]);
  // 25 October 2026: the clocks go back, the day lasts 25 hours.
  const [start, end] = dayBounds('2026-10-25', ZONE);
  assert.equal(end - start, 25 * HOUR);
});

test('today, what is left of it (the current hour in part), tomorrow', () => {
  const now = MIDNIGHT + 12.5 * HOUR; // 12:30
  assert.deepEqual(forecastSummary({ solar, consumption }, { now, timeZone: ZONE }), {
    solarToday: 6,
    solarRemaining: 3.5,
    solarTomorrow: 12,
    consumptionToday: 12,
    consumptionTomorrow: 12,
  });
});

test('no forecast: nulls, never zeros', () => {
  assert.deepEqual(forecastSummary(null, { now: MIDNIGHT, timeZone: ZONE }), {
    solarToday: null,
    solarRemaining: null,
    solarTomorrow: null,
    consumptionToday: null,
    consumptionTomorrow: null,
  });
  assert.equal(energyBetween([], 0, 1), null);
  assert.deepEqual(chartHours(null, { now: MIDNIGHT, timeZone: ZONE }), []);
});

test('the chart keeps today and tomorrow only (tomorrow lasts 25 hours here)', () => {
  const longer = [[MIDNIGHT - HOUR, 1], ...solar, [MIDNIGHT + 49 * HOUR, 1]];
  assert.equal(chartHours(longer, { now: MIDNIGHT + HOUR, timeZone: ZONE }).length, 48);
});
