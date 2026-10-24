// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and the fake VRM of the tests (a real local HTTP server), on a made-up
// Saturday, 24 October 2026 at 14:00 in Paris: "Home ESS", a 48 V battery
// system with solar panels and the grid, one active alarm in its VRM log.
// Never real data. Written as JSON for render.js: node gen.mjs <repo> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { LANGUAGES } = await load('src/i18n.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);
const { startFakeVrm, dataDir, silent, NOW, TOKEN, MINUTE, HOUR } = await load(
  'test/helpers/fake-vrm.js',
);

const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
const WIDGET_KEYS = ['live', 'today', 'forecast', 'alarms'];

/**
 * @description One language: the four widgets of the first installation.
 * @param {string} language - Language.
 * @returns {Promise<object>} The widget contents.
 */
async function contents(language) {
  const clock = { now: NOW - 10 * MINUTE };
  const fake = await startFakeVrm({ now: () => clock.now });
  const gladys = createFakeGladys({ config: { access_token: TOKEN, language } });
  const app = createApp(gladys, {
    baseUrl: fake.url,
    dataDir: dataDir(),
    now: () => clock.now,
    timeZone: 'Europe/Paris',
    timers: false,
    spacingMs: 0,
    logger: silent,
  });
  await gladys.connect();
  await app.whenReady();
  await app.tick();
  // An alarm cleared yesterday, and one raised a moment ago.
  fake.alarms[101] = [
    fake.alarmRecord({
      id: 9002,
      description: 'Low battery',
      device: 'MultiPlus-II',
      started: NOW - 7 * MINUTE,
    }),
    fake.alarmRecord({
      id: 9001,
      description: 'Grid lost alarm',
      device: 'Cerbo GX',
      started: NOW - 21 * HOUR,
      cleared: NOW - 20 * HOUR,
    }),
  ];
  Object.assign(fake.sites[101], { alarm: true, num_alarms: 1, current_alarms: ['Low battery'] });
  Object.assign(fake.sites[101].values, { bs: 24 });
  const settings = { installation: gladys.fake.discoveredDevices[0].external_id };
  clock.now = NOW;
  await app.tick();
  const result = {};
  for (const key of WIDGET_KEYS) {
    result[key] = (await gladys.fake.widgetGet(key, { settings, language })).data.content;
  }
  await gladys.fake.shutdown();
  await fake.close();
  return result;
}

const all = {};
for (const language of LANGUAGES) {
  all[language] = await contents(language);
}

const card = (key) => {
  const widget = manifest.widgets.find((item) => item.key === key);
  return { icon: widget.icon, label: widget.label };
};
writeFileSync(
  out,
  JSON.stringify({
    contents: all,
    images: {},
    cards: Object.fromEntries(WIDGET_KEYS.map((key) => [key, card(key)])),
    now: NOW,
  }),
);
