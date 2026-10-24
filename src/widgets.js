// -----------------------------------------------------------------------------
// Dashboard widgets of the Victron VRM integration.
//
//   - `live`      the energy flow now: battery level (gauge), solar, AC loads,
//                 grid (import or export), battery (charging or discharging),
//                 generator; the state of the system, the battery voltage,
//                 the active alarms and when VRM last received data;
//   - `today`     the day of the installation: solar, consumption, grid import
//                 and export, self-sufficiency, and a chart of the solar yield
//                 and the consumption of each hour;
//   - `forecast`  the VRM forecasts: solar yield today, what is left of it,
//                 tomorrow, the consumption expected, and their hourly chart;
//   - `alarms`    the VRM alarm log: the active alarms first, then the last
//                 cleared ones.
// No button: the integration is read only. Every text exists in the four
// languages (the content is cached per language). Content budget of a card:
// 8 components, 1 main one, 6 tiles, 2 texts (1 body), 1 status, 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { t, ago, formatNumber } from './i18n.js';
import { formatTime } from './time.js';
import { batteryPower } from './device.js';
import { selfSufficiency } from './parse.js';
import { forecastSummary, chartHours } from './forecast.js';

const WIDGETS = { LIVE: 'live', TODAY: 'today', FORECAST: 'forecast', ALARMS: 'alarms' };
const TTL_SECONDS = { live: 60, today: 600, forecast: 1800, alarms: 300, message: 120 };
const IDLE_W = 20;
const MAX_ALARM_CARDS = 6;

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description A widget content made of one message.
 * @param {string} message - The message.
 * @param {object} [options] - `{ heading, ttl }`.
 * @returns {object} The content.
 */
function messageContent(message, { heading, ttl = TTL_SECONDS.message } = {}) {
  const components = [];
  if (heading) {
    components.push({ type: 'text', variant: 'heading', text: clip(heading, 40) });
  }
  components.push({ type: 'text', variant: 'body', text: clip(message, 300) });
  return { ttl_seconds: ttl, components };
}

/**
 * @description A power as a tile shows it: W under 1 kW, kW above.
 * @param {number} watts - Watts (absolute value shown).
 * @returns {{ value: number, unit: string }} The value.
 */
function powerTile(watts) {
  const value = Math.abs(watts);
  if (value >= 1000) {
    return { value: Math.round(value / 100) / 10, unit: 'kW' };
  }
  return { value: Math.round(value), unit: 'W' };
}

/**
 * @description An energy as a tile shows it, kWh.
 * @param {number} kwh - Kilowatt hours.
 * @returns {{ value: number, unit: string }} The value.
 */
const energyTile = (kwh) => ({
  value: kwh >= 100 ? Math.round(kwh) : Math.round(kwh * 10) / 10,
  unit: 'kWh',
});

/**
 * @description The caption of an installation: "Boat · Bulk".
 * @param {object} view - `{ name, values }`.
 * @param {string} [extra] - A second part.
 * @returns {string} The caption.
 */
function captionOf(view, extra) {
  return clip([view.name, extra].filter(Boolean).join(' · '), 80);
}

/**
 * @description The row of the freshness of the data of VRM.
 * @param {object} view - The view of the installation.
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {object} A status row.
 */
function freshnessRow(view, { language, now, timeZone }) {
  const label = clip(t('rowData', language), 40);
  if (!Number.isFinite(view.lastAt)) {
    return { label, value: clip(t('rowNoData', language), 40), color: WIDGET_COLORS.WARNING };
  }
  const time = formatTime(view.lastAt, { language, timeZone, now });
  return {
    label,
    value: clip(t('rowAgo', language, { time, ago: ago(view.lastAt, now, language) }), 40),
    color: view.offline ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
  };
}

/**
 * @description The row of the active alarms.
 * @param {object} view - The view of the installation.
 * @param {string} language - The language.
 * @returns {object|null} A status row, null when unknown.
 */
function alarmsRow(view, language) {
  const count = view.alarmCount;
  if (!Number.isInteger(count)) {
    return null;
  }
  return {
    label: clip(t('rowAlarms', language), 40),
    value: clip(count ? t('valueAlarms', language, { count }) : t('valueNoAlarm', language), 40),
    color: count ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
  };
}

/**
 * @description The "live" widget.
 * @param {object} options - Options.
 * @param {object} options.view - The view of the installation (app.js).
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} options.timeZone - The timezone of Gladys.
 * @returns {object} The content.
 */
function buildLiveWidget({ view, language, now, timeZone }) {
  const values = view.fresh ? view.values : null;
  const rows = [freshnessRow(view, { language, now, timeZone }), alarmsRow(view, language)].filter(
    Boolean,
  );
  if (!values) {
    return {
      ttl_seconds: TTL_SECONDS.live,
      components: [
        { type: 'text', variant: 'caption', text: captionOf(view) },
        {
          type: 'text',
          variant: 'body',
          text: clip(t(view.offline ? 'widgetOffline' : 'widgetWaiting', language), 300),
        },
        { type: 'status', items: rows },
      ],
    };
  }
  const components = [
    { type: 'text', variant: 'caption', text: captionOf(view, values.systemState) },
  ];
  if (Number.isFinite(values.soc)) {
    components.push({
      type: 'gauge',
      value: Math.round(values.soc),
      min: 0,
      max: 100,
      unit: '%',
      label: clip(t('tileBattery', language), 24),
      color:
        values.soc <= view.lowLevel
          ? WIDGET_COLORS.DANGER
          : values.soc < view.lowLevel + 15
            ? WIDGET_COLORS.WARNING
            : WIDGET_COLORS.SUCCESS,
    });
  }
  if (view.parts?.solar && Number.isFinite(values.pv)) {
    const pv = Math.max(0, values.pv);
    components.push({
      type: 'value',
      ...powerTile(pv),
      label: clip(t('tileSolar', language), 24),
      icon: 'sun',
      color: pv > IDLE_W ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (Number.isFinite(values.load)) {
    components.push({
      type: 'value',
      ...powerTile(Math.max(0, values.load)),
      label: clip(t('tileLoads', language), 24),
      icon: 'home',
      color: WIDGET_COLORS.PRIMARY,
    });
  }
  if (Number.isFinite(values.grid)) {
    const direction = values.grid > IDLE_W ? 'import' : values.grid < -IDLE_W ? 'export' : 'idle';
    components.push({
      type: 'value',
      ...powerTile(direction === 'idle' ? 0 : values.grid),
      label: clip(
        t(
          { import: 'tileGridImport', export: 'tileGridExport', idle: 'tileGrid' }[direction],
          language,
        ),
        24,
      ),
      icon: { import: 'download', export: 'upload', idle: 'activity' }[direction],
      color: {
        import: WIDGET_COLORS.WARNING,
        export: WIDGET_COLORS.SUCCESS,
        idle: WIDGET_COLORS.NEUTRAL,
      }[direction],
    });
  }
  const battery = batteryPower(values);
  if (Number.isFinite(battery)) {
    const direction = battery > IDLE_W ? 'charge' : battery < -IDLE_W ? 'discharge' : 'idle';
    components.push({
      type: 'value',
      ...powerTile(direction === 'idle' ? 0 : battery),
      label: clip(
        t(
          { charge: 'tileCharging', discharge: 'tileDischarging', idle: 'tileBatteryIdle' }[
            direction
          ],
          language,
        ),
        24,
      ),
      icon: direction === 'charge' ? 'battery-charging' : 'battery',
      color: direction === 'charge' ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.INFO,
    });
  }
  if (Number.isFinite(values.generator) && values.generator > IDLE_W) {
    components.push({
      type: 'value',
      ...powerTile(values.generator),
      label: clip(t('tileGenerator', language), 24),
      icon: 'zap',
      color: WIDGET_COLORS.WARNING,
    });
  }
  if (Number.isFinite(values.voltage)) {
    rows.splice(1, 0, {
      label: clip(t('rowBatteryVoltage', language), 40),
      value: `${formatNumber(values.voltage, language, 2)} V`,
      color: WIDGET_COLORS.INFO,
    });
  }
  if (Number.isFinite(values.gridAlarm) && values.gridAlarm > 0) {
    rows.push({
      label: clip(t('rowGrid', language), 40),
      value: clip(t('valueGridLost', language), 40),
      color: WIDGET_COLORS.DANGER,
    });
  }
  components.push({ type: 'status', items: rows });
  return { ttl_seconds: TTL_SECONDS.live, components };
}

/**
 * @description The energies of today a widget shows, kWh or null.
 * @param {object} view - The view of the installation.
 * @returns {object} `{ solar, consumption, gridImport, gridExport, charge,
 * discharge, generator, selfSufficiency }`.
 */
function todayEnergies(view) {
  const totals = view.today?.totals ?? null;
  return {
    solar: totals?.solar ?? null,
    consumption: totals?.consumption ?? null,
    gridImport: totals?.gridImport ?? null,
    gridExport: totals?.gridExport ?? null,
    charge: totals?.charge ?? null,
    discharge: totals?.discharge ?? null,
    generator: totals?.generator ?? null,
    selfSufficiency: selfSufficiency(totals),
  };
}

/**
 * @description The "today" widget.
 * @param {object} options - Options.
 * @param {object} options.view - The view of the installation (app.js).
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} options.timeZone - The timezone of Gladys.
 * @returns {object} The content.
 */
function buildTodayWidget({ view, language, now, timeZone }) {
  const energy = todayEnergies(view);
  if (!view.today?.totals) {
    return messageContent(t(view.today ? 'widgetNoEnergy' : 'widgetWaiting', language), {
      heading: view.name,
    });
  }
  const components = [{ type: 'text', variant: 'caption', text: captionOf(view) }];
  const tile = (value, key, icon, color) => {
    if (Number.isFinite(value)) {
      components.push({
        type: 'value',
        ...energyTile(value),
        label: clip(t(key, language), 24),
        icon,
        ...(color ? { color } : {}),
      });
    }
  };
  if (view.parts?.solar) tile(energy.solar, 'tileSolarToday', 'sun', WIDGET_COLORS.WARNING);
  tile(energy.consumption, 'tileConsumptionToday', 'home', WIDGET_COLORS.PRIMARY);
  if (view.parts?.grid) {
    tile(energy.gridImport, 'tileImportToday', 'download');
    tile(energy.gridExport, 'tileExportToday', 'upload', WIDGET_COLORS.SUCCESS);
  }
  if (Number.isFinite(energy.selfSufficiency) && view.parts?.grid) {
    components.push({
      type: 'value',
      value: Math.round(energy.selfSufficiency),
      unit: '%',
      label: clip(t('tileSelfSufficiency', language), 24),
      icon: 'shield',
      color: WIDGET_COLORS.INFO,
    });
  }
  const hours = view.today.hours ?? [];
  const series = [
    ['solar', 'seriesSolar'],
    ['consumption', 'seriesConsumption'],
  ]
    .map(([key, name]) => ({
      name: clip(t(name, language), 24),
      points: hours
        .filter((hour) => Number.isFinite(hour[key]))
        .slice(-48)
        .map((hour) => ({
          t: new Date(hour.at).toISOString(),
          v: Math.round(hour[key] * 100) / 100,
        })),
    }))
    .filter((line) => line.points.length >= 1 && line.points.some((point) => point.v !== 0));
  if (series.length) {
    components.push({
      type: 'chart',
      // Not `bar`: Gladys stacks the bars, solar and consumption would add up.
      chart_type: 'area',
      title: clip(t('chartToday', language), 40),
      unit: 'kWh',
      series,
    });
  }
  const rows = [];
  if (view.parts?.battery && (energy.charge > 0 || energy.discharge > 0)) {
    rows.push({
      label: clip(t('rowBatteryToday', language), 40),
      value: clip(
        t('rowBatteryTodayValue', language, {
          charge: formatNumber(energy.charge ?? 0, language, 1),
          discharge: formatNumber(energy.discharge ?? 0, language, 1),
        }),
        40,
      ),
      color: WIDGET_COLORS.INFO,
    });
  }
  if (energy.generator > 0) {
    rows.push({
      label: clip(t('rowGeneratorToday', language), 40),
      value: `${formatNumber(energy.generator, language, 1)} kWh`,
      color: WIDGET_COLORS.WARNING,
    });
  }
  if (Number.isFinite(view.today.at)) {
    rows.push({
      label: clip(t('rowRead', language), 40),
      value: clip(formatTime(view.today.at, { language, timeZone, now }), 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (rows.length) {
    components.push({ type: 'status', items: rows });
  }
  return { ttl_seconds: TTL_SECONDS.today, components };
}

/**
 * @description The "forecast" widget.
 * @param {object} options - Options.
 * @param {object} options.view - The view of the installation (app.js).
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} options.timeZone - The timezone of Gladys.
 * @returns {object} The content.
 */
function buildForecastWidget({ view, language, now, timeZone }) {
  const forecast = view.forecast;
  if (!forecast || (!forecast.solar && !forecast.consumption)) {
    return messageContent(
      t(forecast || view.forecastRefused ? 'widgetNoForecast' : 'widgetWaiting', language),
      { heading: view.name },
    );
  }
  const zone = view.timezone ?? timeZone;
  const summary = forecastSummary(forecast, { now, timeZone: zone });
  const components = [{ type: 'text', variant: 'caption', text: captionOf(view) }];
  const tile = (value, key, icon, color) => {
    if (Number.isFinite(value)) {
      components.push({
        type: 'value',
        ...energyTile(value),
        label: clip(t(key, language), 24),
        icon,
        color,
      });
    }
  };
  tile(summary.solarToday, 'tileSolarForecastToday', 'sun', WIDGET_COLORS.WARNING);
  tile(summary.solarRemaining, 'tileSolarForecastLeft', 'sunset', WIDGET_COLORS.WARNING);
  tile(summary.solarTomorrow, 'tileSolarForecastTomorrow', 'sunrise', WIDGET_COLORS.PRIMARY);
  tile(
    summary.consumptionTomorrow,
    'tileConsumptionForecastTomorrow',
    'home',
    WIDGET_COLORS.NEUTRAL,
  );
  const series = [
    ['solar', 'seriesSolarForecast'],
    ['consumption', 'seriesConsumptionForecast'],
  ]
    .map(([key, name]) => ({
      name: clip(t(name, language), 24),
      points: chartHours(forecast[key], { now, timeZone: zone }).map(([at, wh]) => ({
        t: new Date(at).toISOString(),
        v: Math.round(wh / 10) / 100,
      })),
    }))
    .filter((line) => line.points.length >= 2);
  if (series.length) {
    components.push({
      type: 'chart',
      chart_type: 'area',
      title: clip(t('chartForecast', language), 40),
      unit: 'kWh',
      now_marker: true,
      series,
    });
  }
  if (Number.isFinite(forecast.at)) {
    components.push({
      type: 'status',
      items: [
        {
          label: clip(t('rowForecastRead', language), 40),
          value: clip(formatTime(forecast.at, { language, timeZone, now }), 40),
          color: WIDGET_COLORS.NEUTRAL,
        },
      ],
    });
  }
  return { ttl_seconds: TTL_SECONDS.forecast, components };
}

/**
 * @description The "alarms" widget.
 * @param {object} options - Options.
 * @param {object} options.view - The view of the installation (app.js).
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} options.timeZone - The timezone of Gladys.
 * @returns {object} The content.
 */
function buildAlarmsWidget({ view, language, now, timeZone }) {
  const components = [{ type: 'text', variant: 'caption', text: captionOf(view) }];
  const alarms = view.alarms;
  const rows = [];
  const active = Array.isArray(alarms) ? alarms.filter((alarm) => alarm.active).length : null;
  const count = Number.isInteger(active) ? active : view.alarmCount;
  if (Number.isInteger(count)) {
    rows.push({
      label: clip(t('rowAlarms', language), 40),
      value: clip(count ? t('valueAlarms', language, { count }) : t('valueNoAlarm', language), 40),
      color: count ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    });
  }
  if (!Array.isArray(alarms)) {
    components.push({
      type: 'text',
      variant: 'body',
      text: clip(
        t(view.alarmsRefused ? 'widgetAlarmsRefused' : 'widgetAlarmsWaiting', language),
        300,
      ),
    });
  } else if (!alarms.length) {
    components.push({
      type: 'text',
      variant: 'body',
      text: clip(t('widgetNoAlarm', language), 300),
    });
  } else {
    components.push({
      type: 'card-list',
      display: 'list',
      items: alarms.slice(0, MAX_ALARM_CARDS).map((alarm) => {
        const when = alarm.active
          ? t('cardSince', language, {
              time: formatTime(alarm.started, { language, timeZone, now }),
            })
          : t('cardCleared', language, {
              time: formatTime(alarm.cleared ?? alarm.started, { language, timeZone, now }),
            });
        return {
          title: clip(alarm.description, 60),
          subtitle: clip([alarm.device, when].filter(Boolean).join(' · '), 60),
          badge: {
            text: clip(t(alarm.active ? 'badgeActive' : 'badgeCleared', language), 16),
            color: alarm.active ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
          },
        };
      }),
    });
  }
  if (Number.isFinite(view.alarmsAt)) {
    rows.push({
      label: clip(t('rowRead', language), 40),
      value: clip(formatTime(view.alarmsAt, { language, timeZone, now }), 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (rows.length) {
    components.push({ type: 'status', items: rows });
  }
  return { ttl_seconds: TTL_SECONDS.alarms, components };
}

export {
  WIDGETS,
  TTL_SECONDS,
  clip,
  messageContent,
  powerTile,
  energyTile,
  todayEnergies,
  buildLiveWidget,
  buildTodayWidget,
  buildForecastWidget,
  buildAlarmsWidget,
};
