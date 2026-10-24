# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **Victron Energy**
installations through **VRM** (Victron Remote Management): a Node.js service
(Node 22+, ESM, no build step) in its own sandboxed Docker container, talking
to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency, and to the official VRM API v2
(<https://vrm-api-docs.victronenergy.com>, base
`https://vrmapi.victronenergy.com/v2`, OpenAPI at
`/docs/docs/openapi.yaml`) with a personal access token of the user
(`x-authorization: Token <token>`). **Read only**: GET requests only.
`type: "device"`, Gladys 5.1.0+ (widgets, scenes), `transports: ["cloud"]`.
Not affiliated with Victron Energy. **Never tested with a real account**: the
shapes were recorded live on the public VRM demo account
(`test/fixtures/vrm-demo.json`, 2026-10-24) and the 401 of a wrong token was
checked live (`{"success":false,"errors":"Invalid accesstoken
received","error_code":"invalid_token"}`).

## Commands

```bash
npm install
npm test                                  # node --test; a fake VRM HTTP server on 127.0.0.1
node --test test/app.test.js              # one file
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js               SDK wiring only (new GladysIntegration + createApp)
src/app.js             every handler; the timer (what is due per installation), devices and
                       states, scene events, scene actions, widgets, configuration buttons, status
src/vrm-api.js         HTTP client: the token header, GET only, statuses -> kinds, one request
                       at a time 1 s apart, the pause of a 429 (Retry-After, 30 s to 1 h)
src/parse.js           the answers made safe (null is null, never 0): installations?extended=1,
                       stats kwh (energy flows), stats forecast, alarm-log
src/forecast.js        the forecasts added up per local day of the installation
src/device.js          one device per installation, its parts, features and states
src/events.js          triggers (alarms, battery with hysteresis, grid alarm, offline), keys, outputs
src/widgets.js         live, today, forecast and alarms widgets
src/time.js            local dates and times (Intl only)
src/store.js           /data/victron-vrm.json
src/config.js          token, reading interval, battery low level, offline delay, language
src/i18n.js            runtime texts, en / fr / de / es
test/helpers/fake-vrm.js        the fake VRM (token check, installations, stats, alarm-log, refusals)
test/fixtures/vrm-demo.json     answers recorded from the live API (public demo account)
.github/scripts/release.mjs     version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store:
  `ext:<selector>:site:<idSite>`, features `…:<key>` (`battery_level`,
  `battery_charge_power`, `battery_discharge_power`, `battery_voltage`,
  `pv_power`, `pv_today`, `grid_power`, `load_power`, `load_today`,
  `generator_power`), feature `category` / `type` / `unit` / `min` / `max`,
  the keys of `config_schema` and `actions`, `last_language`, widgets and
  settings, triggers (fields, options, variables), scene actions (fields,
  outputs). `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json`: never update it to make a test pass
  without a documented migration.
- **Core contracts of the categories** (server/utils/constants.js, the same in
  5.1.0 and on master): battery-storage powers are >= 0 (voltage × signed
  current becomes charge and discharge), grid-sensor `power` is signed
  (import positive) with symmetric bounds, the AC loads are energy-sensor
  `power`, the consumption of the day `index-today`. **Never an energy-sensor
  `index` / `energy` nor a `daily-consumption`**: Gladys would count the
  installation as a consumer and twice next to a Linky.
- **Read only.** Only GET requests (`test/manifest.test.js` checks it). No
  write in 0.x without the maintainer's decision: VRM writes (Dynamic ESS,
  alarm rules) are not a supported way to drive an installation.
- **The pace.** Every request goes through the client queue. Every
  installation of the account in one `installations?extended=1` request at the
  interval of the configuration (5 min by default); per installation, the
  energies of today every 15 min, the alarm log every 30 min or when the
  alarm fields of VRM change, the forecast every hour (6 h when VRM has none,
  24 h when refused). A 429 pauses everything until its Retry-After. Never a
  request from a widget handler or `get_today`; `get_forecast` reads only when
  the forecast kept is older than an hour.
- **Freshness**: VRM data older than the offline delay of the configuration are
  stale: no state published, no battery or grid trigger from them.
- **`should_poll` stays false**: the integration has its own timer.
- **The token** is a `secret`: never logged, never in /data (only a short
  SHA-256 to notice it changed), sent to vrmapi.victronenergy.com only. Test
  tokens never look like a real one (`not-a-real-vrm-token`): the push
  protection of GitHub would block them.
- **Times**: the days of an installation are in its own timezone (VRM gives
  it); the widgets show times in the TZ of Gladys. Never `new Date().getHours()`.
- **Scene events** once per transition, never at the first reading, never
  from a scene action.
- **Charts**: never `bar` for series that must not add up (Gladys stacks the
  bars): `area` or `line`.
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, `src/i18n.js`,
  `docs/*.md`, README) exists in en, fr, de, es; `test/i18n.test.js` checks it.
  German says "du", Spanish "usted". Texts that come from VRM (installation
  names, system state, alarm descriptions) are shown as VRM gives them.
- **Widget images.** After any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  Below 1.0.0 until the maintainer runs Release with `release-as: 1.0.0`.
- **Changelog.** Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## Pitfalls

- `extended` codes are case-sensitive: `S` is the VE.Bus state, `s` the switch
  position; the grid alarm is `Agl` in `extended` (`agl` in the alarm-log doc).
- A value VRM has no data for is `rawValue: null`; `solar_yield` can be
  slightly negative at night (-1.5 W seen): shown as 0.
- `stats?type=kwh` leaves out the flows without energy; `{ "kwh": false }` alone
  means no data at all (null, not zeros). `kwh` is the sum of all flows, not a
  consumption.
- An empty alarm log answers HTTP 200 `success: false`,
  `error_code: "no_results_found"`: an empty list, not an error.
  `installations/{id}/alarms` is the configured alarm rules, not the events.
- `diagnostics` is refused (403) to users without the diagnostics right (the
  demo account): not used; everything comes from `installations?extended=1`.
- Forecasts are Wh per hour, need solar, the location and ~30 days of history;
  `false` when VRM has none.
- A local day can last 23 or 25 hours: always bound days with `toInstant`.
- `node --test` also runs `test/helpers/`: nothing starts on import.
- The validator of the Gladys core creates `gladys-development.duckdb` in the
  current folder: run it from elsewhere.
