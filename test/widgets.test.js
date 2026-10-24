import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  buildLiveWidget,
  buildTodayWidget,
  buildForecastWidget,
  buildAlarmsWidget,
  messageContent,
  powerTile,
  energyTile,
} from '../src/widgets.js';
import { LANGUAGES } from '../src/i18n.js';

const NOW = Date.parse('2026-10-24T12:00:00Z'); // 14:00 in Paris
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const ZONE = 'Europe/Paris';
const MIDNIGHT = Date.parse('2026-10-23T22:00:00Z');
const hours = Array.from({ length: 14 }, (_, i) => ({
  at: MIDNIGHT + i * HOUR,
  solar: i >= 8 ? Math.round(Math.sin((Math.PI * (i - 8)) / 10) * 300) / 100 : 0,
  consumption: 0.4 + (i % 4) * 0.1,
}));
const forecastPoints = (scale) =>
  Array.from({ length: 49 }, (_, i) => [
    MIDNIGHT + i * HOUR,
    i % 24 >= 8 && i % 24 < 18 ? Math.round(scale * Math.sin((Math.PI * ((i % 24) - 8)) / 10)) : 0,
  ]);
const VIEW = {
  id: 101,
  deviceId: 'ext:victron-vrm:site:101',
  name: 'Victron Home ESS',
  identifier: 'c0ffee000101',
  timezone: ZONE,
  parts: { battery: true, solar: true, grid: true, generator: true },
  values: {
    soc: 72,
    voltage: 52.4,
    current: -8.5,
    batteryState: 2,
    systemState: 'Inverting',
    gridAlarm: 0,
    pv: 1850,
    load: 640,
    grid: -210,
    generator: null,
  },
  lastAt: NOW - 4 * MINUTE,
  fresh: true,
  offline: false,
  lowLevel: 20,
  alarmCount: 1,
  alarms: [
    {
      id: 2,
      description: 'Low battery',
      device: 'Multi',
      started: NOW - 30 * MINUTE,
      cleared: null,
      active: true,
    },
    {
      id: 1,
      description: 'Grid lost alarm',
      device: 'Gateway',
      started: NOW - 26 * HOUR,
      cleared: NOW - 25 * HOUR,
      active: false,
    },
  ],
  alarmsAt: NOW - 3 * MINUTE,
  alarmsRefused: false,
  today: {
    date: '2026-10-24',
    totals: {
      solar: 7.8,
      consumption: 6.1,
      gridImport: 1.2,
      gridExport: 2.4,
      charge: 3.1,
      discharge: 1.4,
      generator: 0,
      fromGrid: 1.2,
    },
    hours,
    at: NOW - 5 * MINUTE,
  },
  forecast: {
    date: '2026-10-24',
    solar: forecastPoints(3000),
    consumption: forecastPoints(0).map(([at]) => [at, 450]),
    at: NOW - 20 * MINUTE,
  },
  forecastRefused: false,
};
const views = () => [
  VIEW,
  {
    ...VIEW,
    values: { ...VIEW.values, grid: 3000, current: 12, soc: 15, generator: 2500, gridAlarm: 2 },
  },
  { ...VIEW, values: { ...VIEW.values, grid: 5, current: 0, pv: -1.5 } },
  { ...VIEW, parts: { battery: true }, values: { ...VIEW.values, pv: null, grid: null } },
  { ...VIEW, fresh: false, offline: true, lastAt: NOW - 3 * HOUR },
  { ...VIEW, values: null, lastAt: null, fresh: false, alarmCount: null },
  { ...VIEW, today: null, forecast: null, alarms: null },
  { ...VIEW, today: { ...VIEW.today, totals: null, hours: [] } },
  { ...VIEW, today: { ...VIEW.today, hours: [] } },
  { ...VIEW, forecast: { date: '2026-10-24', solar: null, consumption: null, at: NOW } },
  { ...VIEW, forecast: null, forecastRefused: true, alarms: null, alarmsRefused: true },
  { ...VIEW, alarms: [], alarmCount: 0 },
  {
    ...VIEW,
    alarms: Array.from({ length: 12 }, (_, i) => ({
      id: i,
      description: `A very long alarm description that VRM could give number ${i}`,
      device: 'MultiPlus-II 48/3000/35-32',
      started: NOW - i * HOUR,
      cleared: i % 2 ? NOW : null,
      active: !(i % 2),
    })),
  },
];

/**
 * @description The budget of a card the core enforces.
 * @param {object} content - The content.
 */
function assertBudget(content) {
  const count = (types) => content.components.filter((c) => types.includes(c.type)).length;
  assert.ok(content.components.length <= 8, `${content.components.length} components`);
  assert.ok(count(['chart', 'card-list', 'image']) <= 1);
  assert.ok(count(['value', 'gauge']) <= 6);
  assert.ok(count(['text']) <= 2);
  assert.ok(
    content.components.filter((c) => c.type === 'text' && c.variant === 'body').length <= 1,
  );
  assert.ok(count(['status']) <= 1);
  assert.ok(content.ttl_seconds >= 10 && content.ttl_seconds <= 3600);
}

test('every widget passes the checks of the core, in the four languages', () => {
  for (const language of LANGUAGES) {
    for (const view of views()) {
      const options = { view, language, now: NOW, timeZone: ZONE };
      for (const content of [
        buildLiveWidget(options),
        buildTodayWidget(options),
        buildForecastWidget(options),
        buildAlarmsWidget(options),
      ]) {
        assert.deepEqual(validateWidgetContent(content), [], JSON.stringify(content));
        assertBudget(content);
      }
    }
    assert.deepEqual(validateWidgetContent(messageContent('x'.repeat(400), { heading: 'y' })), []);
  }
});

test('live: battery gauge, solar, loads, grid to / from, battery charging / discharging', () => {
  const content = buildLiveWidget({ view: VIEW, language: 'fr', now: NOW, timeZone: ZONE });
  assert.equal(content.components[0].text, 'Victron Home ESS · Inverting');
  const tiles = content.components.filter((c) => c.type === 'value' || c.type === 'gauge');
  assert.deepEqual(
    tiles.map((tile) => [tile.label, tile.value, tile.unit ?? null, tile.color]),
    [
      ['Batterie', 72, '%', 'success'],
      ['Solaire', 1.9, 'kW', 'warning'],
      ['Consommation', 640, 'W', 'primary'],
      ['Vers le réseau', 210, 'W', 'success'],
      ['En décharge', 445, 'W', 'info'],
    ],
  );
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((row) => [row.label, row.value]),
    [
      ['Données reçues', '13:56 (il y a 4 min)'],
      ['Tension batterie', '52,4 V'],
      ['Alarmes', '1 active(s)'],
    ],
  );
});

test('live: low battery in red, grid import, generator running, grid lost', () => {
  const content = buildLiveWidget({ view: views()[1], language: 'en', now: NOW, timeZone: ZONE });
  const tiles = content.components.filter((c) => c.type === 'value' || c.type === 'gauge');
  assert.deepEqual(
    tiles.map((tile) => [tile.label, tile.value, tile.color]),
    [
      ['Battery', 15, 'danger'],
      ['Solar', 1.9, 'warning'],
      ['AC loads', 640, 'primary'],
      ['From the grid', 3, 'warning'],
      ['Charging', 629, 'success'],
      ['Generator', 2.5, 'warning'],
    ].map(([label, value, color]) => [label, value, color]),
  );
  const rows = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(rows.at(-1), { label: 'Grid', value: 'lost (alarm)', color: 'danger' });
});

test('live: offline or never read, a message and the freshness', () => {
  const offline = buildLiveWidget({ view: views()[4], language: 'en', now: NOW, timeZone: ZONE });
  assert.match(offline.components[1].text, /not received any data/);
  assert.equal(offline.components[2].items[0].color, 'danger');
  const never = buildLiveWidget({ view: views()[5], language: 'en', now: NOW, timeZone: ZONE });
  assert.match(never.components[1].text, /Waiting/);
  assert.deepEqual(never.components[2].items, [
    { label: 'Data received', value: 'none yet', color: 'warning' },
  ]);
});

test('today: energies, self-sufficiency, the hourly chart in kWh', () => {
  const content = buildTodayWidget({ view: VIEW, language: 'en', now: NOW, timeZone: ZONE });
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((tile) => [tile.label, tile.value, tile.unit]),
    [
      ['Solar today', 7.8, 'kWh'],
      ['Consumed', 6.1, 'kWh'],
      ['Imported', 1.2, 'kWh'],
      ['Exported', 2.4, 'kWh'],
      ['Self-sufficiency', 80, '%'],
    ],
  );
  const chart = content.components.find((c) => c.type === 'chart');
  assert.equal(chart.chart_type, 'area', 'Gladys stacks the bars');
  assert.equal(chart.unit, 'kWh');
  assert.deepEqual(
    chart.series.map((line) => [line.name, line.points.length]),
    [
      ['Solar', 14],
      ['Consumption', 14],
    ],
  );
  const rows = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(rows[0], { label: 'Battery today', value: '+3.1 / −1.4 kWh', color: 'info' });
});

test('today: no energy yet, or not read yet', () => {
  const none = buildTodayWidget({ view: views()[7], language: 'en', now: NOW, timeZone: ZONE });
  assert.match(none.components.at(-1).text, /no energy for today/);
  const waiting = buildTodayWidget({ view: views()[6], language: 'en', now: NOW, timeZone: ZONE });
  assert.match(waiting.components.at(-1).text, /Waiting/);
});

test('forecast: today, still to come, tomorrow, consumption tomorrow, the hourly chart', () => {
  const content = buildForecastWidget({ view: VIEW, language: 'en', now: NOW, timeZone: ZONE });
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((tile) => tile.label),
    ['Solar today', 'Solar still to come', 'Solar tomorrow', 'Consumption tomorrow'],
  );
  assert.ok(tiles[1].value < tiles[0].value);
  const chart = content.components.find((c) => c.type === 'chart');
  assert.equal(chart.now_marker, true);
  assert.ok(chart.series.every((line) => line.points.length >= 48));
  const none = buildForecastWidget({ view: views()[9], language: 'fr', now: NOW, timeZone: ZONE });
  assert.match(none.components.at(-1).text, /30 jours/);
});

test('alarms: active first with their start, then the cleared ones; 6 cards at most', () => {
  const content = buildAlarmsWidget({ view: VIEW, language: 'en', now: NOW, timeZone: ZONE });
  const list = content.components.find((c) => c.type === 'card-list');
  assert.deepEqual(list.items, [
    {
      title: 'Low battery',
      subtitle: 'Multi · since 13:30',
      badge: { text: 'Active', color: 'danger' },
    },
    {
      title: 'Grid lost alarm',
      subtitle: 'Gateway · cleared Fri 23, 13:00',
      badge: { text: 'Cleared', color: 'neutral' },
    },
  ]);
  const many = buildAlarmsWidget({
    view: views().at(-1),
    language: 'en',
    now: NOW,
    timeZone: ZONE,
  });
  assert.equal(many.components.find((c) => c.type === 'card-list').items.length, 6);
  const none = buildAlarmsWidget({ view: views()[11], language: 'en', now: NOW, timeZone: ZONE });
  assert.match(none.components[1].text, /No alarm/);
  assert.equal(none.components.at(-1).items[0].color, 'success');
});

test('tiles: W under 1 kW, kW above; kWh with one decimal, none from 100', () => {
  assert.deepEqual(powerTile(-950), { value: 950, unit: 'W' });
  assert.deepEqual(powerTile(12345), { value: 12.3, unit: 'kW' });
  assert.deepEqual(energyTile(7.86), { value: 7.9, unit: 'kWh' });
  assert.deepEqual(energyTile(123.4), { value: 123, unit: 'kWh' });
});
