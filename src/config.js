// -----------------------------------------------------------------------------
// Configuration of the Victron VRM integration.
//
// Fields of the config_schema:
//   - `access_token`   the personal access token of the VRM account (VRM →
//                      Preferences → Integrations → Access tokens): a
//                      `secret`, never sent back to the UI, never logged, never
//                      written to /data; only sent to vrmapi.victronenergy.com;
//   - `poll_interval`  seconds between two readings of the installations
//                      (60 to 900, 300 by default): VRM receives the data of an
//                      installation every 1 to 15 minutes (its logging interval);
//   - `battery_low_level` the battery level (%) of the "battery low" trigger;
//   - `offline_after`  minutes without new data before an installation is
//                      "offline" (trigger, widgets);
//   - `language`       language of the texts Gladys does not ask for in a
//                      language (feature names, scene texts): `auto` follows the
//                      language of the last widget, or the timezone.
//
// Internal key, outside the config_schema (never shown in the UI):
//   - `last_language` language of the last widget request.
// -----------------------------------------------------------------------------

import { isLanguage } from './i18n.js';
import { readToken } from './vrm-api.js';

const AUTO_LANGUAGE = 'auto';
const INTERNAL_KEYS = { language: 'last_language' };
const POLL_INTERVALS = ['60', '120', '300', '600', '900'];
const DEFAULT_POLL_SECONDS = 300;
const LOW_LEVELS = ['10', '15', '20', '25', '30', '40', '50'];
const DEFAULT_LOW_LEVEL = 20;
const OFFLINE_DELAYS = ['30', '60', '120', '240'];
const DEFAULT_OFFLINE_MINUTES = 60;

const readString = (raw) =>
  typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';

/**
 * @description A value of a select, else its default.
 * @param {unknown} raw - The value.
 * @param {string[]} options - The values of the select.
 * @param {number} fallback - The default.
 * @returns {number} The number.
 */
const readOption = (raw, options, fallback) => {
  const text = readString(raw);
  return options.includes(text) ? Number(text) : fallback;
};

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config values.
 * @returns {object} `{ token, pollSeconds, lowLevel, offlineMinutes, language }`.
 * @example
 * normalizeConfig({ access_token: 'Token abc' }); // token 'abc'
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  return {
    // A token pasted with its "Token " prefix or a line break is cut there.
    token: readToken(config.access_token),
    pollSeconds: readOption(config.poll_interval, POLL_INTERVALS, DEFAULT_POLL_SECONDS),
    lowLevel: readOption(config.battery_low_level, LOW_LEVELS, DEFAULT_LOW_LEVEL),
    offlineMinutes: readOption(config.offline_after, OFFLINE_DELAYS, DEFAULT_OFFLINE_MINUTES),
    language: isLanguage(config.language) ? config.language : AUTO_LANGUAGE,
  };
}

// The timezones of the countries that speak the languages of the integration:
// the automatic language before any widget was shown.
const TIMEZONE_LANGUAGES = {
  fr: [
    'Europe/Paris',
    'Europe/Monaco',
    'Europe/Brussels',
    'Europe/Luxembourg',
    'Indian/Reunion',
    'Indian/Mayotte',
    'America/Guadeloupe',
    'America/Martinique',
    'America/Cayenne',
    'America/Miquelon',
    'Pacific/Noumea',
    'Pacific/Tahiti',
    'America/Montreal',
    'Africa/Abidjan',
    'Africa/Dakar',
    'Africa/Casablanca',
    'Africa/Algiers',
    'Africa/Tunis',
  ],
  de: ['Europe/Berlin', 'Europe/Busingen', 'Europe/Vienna', 'Europe/Zurich', 'Europe/Vaduz'],
  es: [
    'Europe/Madrid',
    'Atlantic/Canary',
    'Africa/Ceuta',
    'America/Mexico_City',
    'America/Bogota',
    'America/Lima',
    'America/Santiago',
    'America/Caracas',
    'America/Montevideo',
    'America/Asuncion',
    'America/La_Paz',
    'America/Guayaquil',
    'America/Havana',
    'America/Costa_Rica',
    'America/Panama',
  ],
};

/**
 * @description The language of the texts guessed from a timezone, before
 * any widget was shown.
 * @param {string} timezone - IANA timezone of Gladys.
 * @returns {string} en, fr, de or es.
 * @example
 * guessLanguage('Europe/Paris'); // -> 'fr'
 */
function guessLanguage(timezone) {
  const zone = String(timezone ?? '');
  if (zone.startsWith('America/Argentina/')) {
    return 'es';
  }
  const found = Object.entries(TIMEZONE_LANGUAGES).find(([, zones]) => zones.includes(zone));
  return found ? found[0] : 'en';
}

/**
 * @description Read the stored language of the last widget request.
 * @param {object} [rawConfig] - The raw config values.
 * @param {string} fallback - The language to keep when nothing valid is stored.
 * @returns {string} The language.
 */
function readLanguage(rawConfig, fallback) {
  const language = (rawConfig ?? {})[INTERNAL_KEYS.language];
  return isLanguage(language) ? language : fallback;
}

export {
  AUTO_LANGUAGE,
  INTERNAL_KEYS,
  POLL_INTERVALS,
  DEFAULT_POLL_SECONDS,
  LOW_LEVELS,
  DEFAULT_LOW_LEVEL,
  OFFLINE_DELAYS,
  DEFAULT_OFFLINE_MINUTES,
  normalizeConfig,
  guessLanguage,
  readLanguage,
};
