// -----------------------------------------------------------------------------
// Entry point of the Victron VRM external integration.
//
// The Victron Energy installations of a VRM account (vrm.victronenergy.com),
// through the official VRM API v2 and a personal access token, read only:
//   - devices: one per installation (battery, solar, grid, AC loads,
//     generator, energies of the day), offered on the Discovery screen
//     (src/device.js);
//   - scene triggers: VRM alarm raised / cleared, battery low / full, grid
//     lost / restored, installation offline / online, access refused;
//   - scene actions: the energies of today, the solar and consumption forecasts;
//   - dashboard widgets: energy flow now, today, forecast, alarms.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the timezone of Gladys: the times shown by the widgets)
// The SDK reads the first three: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the Victron VRM integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
