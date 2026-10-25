import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  TODAY_OUTPUTS,
  FORECAST_OUTPUTS,
  ACCESS_REASONS,
} from '../src/events.js';
import { ACTIONS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import {
  AUTO_LANGUAGE,
  POLL_INTERVALS,
  DEFAULT_POLL_SECONDS,
  LOW_LEVELS,
  DEFAULT_LOW_LEVEL,
  OFFLINE_DELAYS,
  DEFAULT_OFFLINE_MINUTES,
} from '../src/config.js';
import { LANGUAGES } from '../src/i18n.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const REPO = 'William-De71/gladys-victron-vrm';

test('a device integration, in lockstep with package.json, at 0.x until 1.0.0 is decided', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'Victron VRM');
  assert.equal(manifest.version, pkg.version);
  assert.match(pkg.version, /^0\./);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-victron-vrm:${pkg.version}`);
  assert.equal(manifest.cover_image, `https://raw.githubusercontent.com/${REPO}/main/cover.jpg`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-victron-vrm');
});

test('declares the cloud transport: vrmapi.victronenergy.com only, GET only', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  const api = source('../src/vrm-api.js');
  assert.match(api, /https:\/\/vrmapi\.victronenergy\.com\/v2/);
  assert.match(api, /method: 'GET'/);
  assert.doesNotMatch(api, /method: '(POST|PUT|PATCH|DELETE)'/, 'read only');
  for (const file of [
    'app',
    'parse',
    'events',
    'widgets',
    'device',
    'forecast',
    'store',
    'time',
    'config',
  ]) {
    assert.doesNotMatch(
      source(`../src/${file}.js`),
      /fetch\(|node:https?|node:net|node:dgram/,
      file,
    );
  }
  // A single channel: no transport to publish per device.
  assert.doesNotMatch(source('../src/app.js'), /publishTransports|GLADYS_PREFER_LOCAL/);
});

test('requires Gladys 5.3.0 (catalog keywords); no permission', () => {
  assert.equal(manifest.gladys_version, '>=5.3.0');
  assert.deepEqual(manifest.categories, ['energy']);
  const text = JSON.stringify(manifest);
  assert.doesNotMatch(text, /"source":"houses"/, 'houses need 5.2.0');
  for (const key of [
    'location',
    'network_wake',
    'containers',
    'network_discovery',
    'webhooks',
    'messaging',
    'countries',
    'energy_contracts',
  ]) {
    assert.equal(manifest[key], undefined, `${key} (permission, or a newer Gladys)`);
  }
  for (const widget of manifest.widgets) {
    assert.equal(widget.action_timeout_seconds, undefined, `${widget.key}: no button`);
  }
  const config = byKey(manifest.config_schema);
  assert.deepEqual(
    [config.get('access_token').type, config.get('access_token').required],
    ['secret', true],
  );
  for (const [key, options, fallback] of [
    ['poll_interval', POLL_INTERVALS, DEFAULT_POLL_SECONDS],
    ['battery_low_level', LOW_LEVELS, DEFAULT_LOW_LEVEL],
    ['offline_after', OFFLINE_DELAYS, DEFAULT_OFFLINE_MINUTES],
  ]) {
    assert.equal(config.get(key).type, 'select', key);
    assert.deepEqual(values(config.get(key)), options, key);
    assert.equal(config.get(key).default, String(fallback), key);
  }
  for (const field of manifest.config_schema) {
    assert.ok(['section', 'string', 'secret', 'select', 'boolean'].includes(field.type), field.key);
  }
});

test('declares exactly the scene triggers, actions and widgets the code handles', () => {
  const app = source('../src/app.js');
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key),
    Object.values(TRIGGERS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key),
    Object.values(SCENE_ACTIONS),
  );
  assert.deepEqual(
    manifest.widgets.map((w) => w.key),
    Object.values(WIDGETS),
  );
  for (const key of Object.keys(WIDGETS)) {
    assert.match(app, new RegExp(`onWidgetGet\\(WIDGETS\\.${key}`), key);
  }
  assert.doesNotMatch(app, /onWidgetAction|onSetValue/, 'read only: no button, no command');
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.match(app, new RegExp(`onSceneAction\\(SCENE_ACTIONS\\.${key}`), key);
  }
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  for (const key of Object.keys(ACTIONS)) {
    assert.match(app, new RegExp(`onAction\\(ACTIONS\\.${key}`), key);
  }
  const outputs = (key) =>
    byKey(manifest.scene_actions)
      .get(key)
      .outputs.map((output) => output.key);
  assert.deepEqual(outputs('get_today'), TODAY_OUTPUTS);
  assert.deepEqual(outputs('get_forecast'), FORECAST_OUTPUTS);
  // Every trigger field is a key of the event data (the core compares them),
  // and a variable too.
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.ok(
        trigger.variables.some((variable) => variable.key === field.key),
        `${trigger.key}.${field.key}`,
      );
      if (field.source) assert.equal(field.source, 'devices');
    }
  }
  const triggers = byKey(manifest.scene_triggers);
  assert.deepEqual(
    values(byKey(triggers.get('access_refused').fields).get('reason')),
    ACCESS_REASONS,
  );
});

test('limits of the store: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.actions.length <= 10);
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.scene_triggers.length <= 20 && manifest.scene_actions.length <= 20);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10 && trigger.variables.length <= 20, trigger.key);
    assert.ok(trigger.key.length <= 40);
  }
  for (const action of manifest.scene_actions) {
    assert.ok(action.fields.length <= 10, `${action.key}: ${action.fields.length} fields`);
    assert.ok(action.outputs.length <= 20, action.key);
  }
  for (const action of [...manifest.scene_actions, ...manifest.actions]) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
  }
  for (const widget of manifest.widgets) {
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('offers the languages of the code, automatic by default', () => {
  const field = byKey(manifest.config_schema).get('language');
  assert.deepEqual(values(field), [AUTO_LANGUAGE, ...LANGUAGES]);
  assert.equal(field.default, AUTO_LANGUAGE);
});

test('catalog fields of Gladys 5.3: search keywords, available worldwide', () => {
  assert.equal(manifest.gladys_version, '>=5.3.0');
  assert.ok(Array.isArray(manifest.keywords), 'keywords');
  assert.ok(manifest.keywords.length >= 1 && manifest.keywords.length <= 10, '1 to 10 keywords');
  for (const keyword of manifest.keywords) {
    assert.ok(keyword.length <= 30 && keyword.trim().length >= 2, keyword);
  }
  const normalized = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length, 'unique once trimmed and lowercased');
  assert.ok(!normalized.includes(manifest.name.toLowerCase()), 'the name is already searched');
  // No `countries`: usable anywhere, the catalog shows it in every country.
  assert.equal(manifest.countries, undefined);
});
