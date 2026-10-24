// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: feature names, widget contents, statuses, scene texts and errors,
// results of the configuration buttons. Vocabulary of the Gladys interface
// (appareil / Gerät / dispositivo) and of its energy categories (batterie de
// stockage, réseau électrique); German says "du", Spanish "usted", like
// Gladys. Installation names and alarm texts come from VRM, never translated.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const TEXTS = {
  // features
  feature_battery_level: {
    en: 'Battery level',
    fr: 'Niveau de batterie',
    de: 'Batteriestand',
    es: 'Nivel de batería',
  },
  feature_battery_charge_power: {
    en: 'Battery charge power',
    fr: 'Puissance de charge de la batterie',
    de: 'Ladeleistung der Batterie',
    es: 'Potencia de carga de la batería',
  },
  feature_battery_discharge_power: {
    en: 'Battery discharge power',
    fr: 'Puissance de décharge de la batterie',
    de: 'Entladeleistung der Batterie',
    es: 'Potencia de descarga de la batería',
  },
  feature_battery_voltage: {
    en: 'Battery voltage',
    fr: 'Tension de la batterie',
    de: 'Batteriespannung',
    es: 'Tensión de la batería',
  },
  feature_pv_power: {
    en: 'Solar production',
    fr: 'Production solaire',
    de: 'Solarerzeugung',
    es: 'Producción solar',
  },
  feature_pv_today: {
    en: 'Solar production today',
    fr: 'Production solaire du jour',
    de: 'Solarerzeugung heute',
    es: 'Producción solar de hoy',
  },
  feature_grid_power: {
    en: 'Grid power (import +, export −)',
    fr: 'Réseau électrique (import +, export −)',
    de: 'Netzleistung (Bezug +, Einspeisung −)',
    es: 'Red eléctrica (importación +, exportación −)',
  },
  feature_load_power: {
    en: 'AC loads',
    fr: 'Consommation AC',
    de: 'AC-Verbrauch',
    es: 'Consumo AC',
  },
  feature_load_today: {
    en: 'Consumption today',
    fr: 'Consommation du jour',
    de: 'Verbrauch heute',
    es: 'Consumo de hoy',
  },
  feature_generator_power: {
    en: 'Generator power',
    fr: 'Puissance du groupe électrogène',
    de: 'Generatorleistung',
    es: 'Potencia del generador',
  },

  // widgets: tiles (24 characters at most)
  tileBattery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  tileSolar: { en: 'Solar', fr: 'Solaire', de: 'Solar', es: 'Solar' },
  tileLoads: { en: 'AC loads', fr: 'Consommation', de: 'Verbrauch', es: 'Consumo' },
  tileGrid: { en: 'Grid', fr: 'Réseau', de: 'Netz', es: 'Red' },
  tileGridImport: {
    en: 'From the grid',
    fr: 'Depuis le réseau',
    de: 'Aus dem Netz',
    es: 'Desde la red',
  },
  tileGridExport: { en: 'To the grid', fr: 'Vers le réseau', de: 'Ins Netz', es: 'Hacia la red' },
  tileCharging: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },
  tileDischarging: {
    en: 'Discharging',
    fr: 'En décharge',
    de: 'Entlädt',
    es: 'Descargando',
  },
  tileBatteryIdle: {
    en: 'Battery idle',
    fr: 'Batterie au repos',
    de: 'Batterie ruht',
    es: 'Batería en reposo',
  },
  tileGenerator: { en: 'Generator', fr: 'Groupe électrogène', de: 'Generator', es: 'Generador' },
  tileSolarToday: {
    en: 'Solar today',
    fr: 'Solaire du jour',
    de: 'Solar heute',
    es: 'Solar de hoy',
  },
  tileConsumptionToday: {
    en: 'Consumed',
    fr: 'Consommé',
    de: 'Verbraucht',
    es: 'Consumido',
  },
  tileImportToday: { en: 'Imported', fr: 'Importé', de: 'Bezogen', es: 'Importado' },
  tileExportToday: { en: 'Exported', fr: 'Exporté', de: 'Eingespeist', es: 'Exportado' },
  tileSelfSufficiency: {
    en: 'Self-sufficiency',
    fr: 'Autonomie',
    de: 'Autarkie',
    es: 'Autosuficiencia',
  },
  tileSolarForecastToday: {
    en: 'Solar today',
    fr: 'Solaire du jour',
    de: 'Solar heute',
    es: 'Solar de hoy',
  },
  tileSolarForecastLeft: {
    en: 'Solar still to come',
    fr: 'Solaire restant',
    de: 'Solar noch erwartet',
    es: 'Solar pendiente',
  },
  tileSolarForecastTomorrow: {
    en: 'Solar tomorrow',
    fr: 'Solaire demain',
    de: 'Solar morgen',
    es: 'Solar mañana',
  },
  tileConsumptionForecastTomorrow: {
    en: 'Consumption tomorrow',
    fr: 'Consommation demain',
    de: 'Verbrauch morgen',
    es: 'Consumo mañana',
  },

  // widgets: chart series (24) and titles (40)
  seriesSolar: { en: 'Solar', fr: 'Solaire', de: 'Solar', es: 'Solar' },
  seriesConsumption: { en: 'Consumption', fr: 'Consommation', de: 'Verbrauch', es: 'Consumo' },
  seriesSolarForecast: {
    en: 'Solar (forecast)',
    fr: 'Solaire (prévision)',
    de: 'Solar (Prognose)',
    es: 'Solar (previsión)',
  },
  seriesConsumptionForecast: {
    en: 'Consumption (forecast)',
    fr: 'Conso. (prévision)',
    de: 'Verbrauch (Prognose)',
    es: 'Consumo (previsión)',
  },
  chartToday: {
    en: 'Energy per hour today',
    fr: 'Énergie par heure aujourd’hui',
    de: 'Energie pro Stunde heute',
    es: 'Energía por hora hoy',
  },
  chartForecast: {
    en: 'Forecast per hour',
    fr: 'Prévision par heure',
    de: 'Prognose pro Stunde',
    es: 'Previsión por hora',
  },

  // widgets: status rows (label and value 40 at most)
  rowData: {
    en: 'Data received',
    fr: 'Données reçues',
    de: 'Daten erhalten',
    es: 'Datos recibidos',
  },
  rowNoData: { en: 'none yet', fr: 'aucune encore', de: 'noch keine', es: 'ninguno todavía' },
  rowAgo: {
    en: '{time} ({ago})',
    fr: '{time} ({ago})',
    de: '{time} ({ago})',
    es: '{time} ({ago})',
  },
  rowAlarms: { en: 'Alarms', fr: 'Alarmes', de: 'Alarme', es: 'Alarmas' },
  rowBatteryVoltage: {
    en: 'Battery voltage',
    fr: 'Tension batterie',
    de: 'Batteriespannung',
    es: 'Tensión de batería',
  },
  rowGrid: { en: 'Grid', fr: 'Réseau', de: 'Netz', es: 'Red' },
  rowBatteryToday: {
    en: 'Battery today',
    fr: 'Batterie du jour',
    de: 'Batterie heute',
    es: 'Batería hoy',
  },
  rowBatteryTodayValue: {
    en: '+{charge} / −{discharge} kWh',
    fr: '+{charge} / −{discharge} kWh',
    de: '+{charge} / −{discharge} kWh',
    es: '+{charge} / −{discharge} kWh',
  },
  rowGeneratorToday: {
    en: 'Generator today',
    fr: 'Groupe électrogène du jour',
    de: 'Generator heute',
    es: 'Generador hoy',
  },
  rowRead: { en: 'Read from VRM', fr: 'Lu sur VRM', de: 'Von VRM gelesen', es: 'Leído en VRM' },
  rowForecastRead: {
    en: 'Forecast read',
    fr: 'Prévision lue',
    de: 'Prognose gelesen',
    es: 'Previsión leída',
  },
  valueAlarms: {
    en: '{count} active',
    fr: '{count} active(s)',
    de: '{count} aktiv',
    es: '{count} activa(s)',
  },
  valueNoAlarm: { en: 'none', fr: 'aucune', de: 'keine', es: 'ninguna' },
  valueGridLost: {
    en: 'lost (alarm)',
    fr: 'perdu (alarme)',
    de: 'ausgefallen (Alarm)',
    es: 'perdida (alarma)',
  },

  // widgets: alarm cards (title / subtitle 60, badge 16)
  badgeActive: { en: 'Active', fr: 'Active', de: 'Aktiv', es: 'Activa' },
  badgeCleared: { en: 'Cleared', fr: 'Terminée', de: 'Beendet', es: 'Terminada' },
  cardSince: { en: 'since {time}', fr: 'depuis {time}', de: 'seit {time}', es: 'desde {time}' },
  cardCleared: {
    en: 'cleared {time}',
    fr: 'terminée {time}',
    de: 'beendet {time}',
    es: 'terminada {time}',
  },

  // widgets: messages (300 at most)
  widgetWaiting: {
    en: 'Waiting for the first reading from VRM.',
    fr: 'En attente de la première lecture sur VRM.',
    de: 'Warte auf die erste Abfrage bei VRM.',
    es: 'Esperando la primera lectura en VRM.',
  },
  widgetOffline: {
    en: 'VRM has not received any data from this installation for a while: check the internet connection of the GX device.',
    fr: 'VRM ne reçoit plus de données de cette installation depuis un moment : vérifiez la connexion internet de l’appareil GX.',
    de: 'VRM erhält seit einer Weile keine Daten mehr von dieser Anlage: Prüfe die Internetverbindung des GX-Geräts.',
    es: 'VRM no recibe datos de esta instalación desde hace un rato: compruebe la conexión a internet del dispositivo GX.',
  },
  widgetNoEnergy: {
    en: 'VRM has no energy for today yet.',
    fr: 'VRM n’a pas encore d’énergie pour aujourd’hui.',
    de: 'VRM hat für heute noch keine Energie.',
    es: 'VRM aún no tiene energía para hoy.',
  },
  widgetNoForecast: {
    en: 'VRM has no forecast for this installation (it needs solar panels, its location and about 30 days of history).',
    fr: 'VRM n’a pas de prévision pour cette installation (il lui faut des panneaux solaires, sa position et environ 30 jours d’historique).',
    de: 'VRM hat keine Prognose für diese Anlage (dazu braucht es Solarmodule, ihren Standort und etwa 30 Tage Verlauf).',
    es: 'VRM no tiene previsión para esta instalación (necesita paneles solares, su ubicación y unos 30 días de historial).',
  },
  widgetNoAlarm: {
    en: 'No alarm in the VRM log.',
    fr: 'Aucune alarme dans le journal VRM.',
    de: 'Kein Alarm im VRM-Protokoll.',
    es: 'Ninguna alarma en el registro de VRM.',
  },
  widgetAlarmsWaiting: {
    en: 'The VRM alarm log has not been read yet.',
    fr: 'Le journal des alarmes VRM n’a pas encore été lu.',
    de: 'Das VRM-Alarmprotokoll wurde noch nicht gelesen.',
    es: 'El registro de alarmas de VRM aún no se ha leído.',
  },
  widgetAlarmsRefused: {
    en: 'VRM does not give the alarm log of this installation to this account.',
    fr: 'VRM ne donne pas le journal des alarmes de cette installation à ce compte.',
    de: 'VRM gibt diesem Konto das Alarmprotokoll dieser Anlage nicht.',
    es: 'VRM no da el registro de alarmas de esta instalación a esta cuenta.',
  },

  // connection status (200 at most)
  statusNoToken: {
    en: 'Enter a VRM access token in the configuration.',
    fr: 'Saisissez un jeton d’accès VRM dans la configuration.',
    de: 'Gib in der Konfiguration ein VRM-Zugriffstoken ein.',
    es: 'Introduzca un token de acceso de VRM en la configuración.',
  },
  statusWaiting: {
    en: 'Connecting to VRM…',
    fr: 'Connexion à VRM…',
    de: 'Verbindung mit VRM…',
    es: 'Conectando con VRM…',
  },
  statusNoSite: {
    en: 'This VRM account has no installation.',
    fr: 'Ce compte VRM n’a aucune installation.',
    de: 'Dieses VRM-Konto hat keine Anlage.',
    es: 'Esta cuenta de VRM no tiene ninguna instalación.',
  },
  statusOk: {
    en: '{count} installation(s): {sites}.',
    fr: '{count} installation(s) : {sites}.',
    de: '{count} Anlage(n): {sites}.',
    es: '{count} instalación(es): {sites}.',
  },
  siteLine: {
    en: '{name} {value}',
    fr: '{name} {value}',
    de: '{name} {value}',
    es: '{name} {value}',
  },
  siteLineOffline: {
    en: '{name} offline',
    fr: '{name} hors ligne',
    de: '{name} offline',
    es: '{name} sin conexión',
  },
  statusPaused: {
    en: 'VRM asked to slow down: readings paused for a moment.',
    fr: 'VRM demande de ralentir : lectures en pause un moment.',
    de: 'VRM bittet um weniger Anfragen: Abfragen kurz pausiert.',
    es: 'VRM pide ir más despacio: lecturas en pausa un momento.',
  },

  // errors
  errAuth: {
    en: 'VRM refuses the access token: create a new one in VRM (Preferences → Integrations → Access tokens).',
    fr: 'VRM refuse le jeton d’accès : créez-en un nouveau dans VRM (Preferences → Integrations → Access tokens).',
    de: 'VRM lehnt das Zugriffstoken ab: Erstelle ein neues in VRM (Preferences → Integrations → Access tokens).',
    es: 'VRM rechaza el token de acceso: cree uno nuevo en VRM (Preferences → Integrations → Access tokens).',
  },
  errForbidden: {
    en: 'VRM refuses this request to this account.',
    fr: 'VRM refuse cette demande à ce compte.',
    de: 'VRM verweigert diesem Konto diese Anfrage.',
    es: 'VRM rechaza esta petición para esta cuenta.',
  },
  errRateLimit: {
    en: 'VRM asked to slow down: try again in a moment.',
    fr: 'VRM demande de ralentir : réessayez dans un moment.',
    de: 'VRM bittet um weniger Anfragen: Versuche es gleich noch einmal.',
    es: 'VRM pide ir más despacio: inténtelo de nuevo en un momento.',
  },
  errServer: {
    en: 'VRM is having trouble: try again later.',
    fr: 'VRM rencontre un problème : réessayez plus tard.',
    de: 'VRM hat ein Problem: Versuche es später noch einmal.',
    es: 'VRM tiene un problema: inténtelo de nuevo más tarde.',
  },
  errUnreachable: {
    en: 'VRM cannot be reached: check the internet connection of Gladys.',
    fr: 'VRM est injoignable : vérifiez la connexion internet de Gladys.',
    de: 'VRM ist nicht erreichbar: Prüfe die Internetverbindung von Gladys.',
    es: 'No se puede acceder a VRM: compruebe la conexión a internet de Gladys.',
  },
  errFailed: {
    en: 'VRM request failed: {detail}',
    fr: 'Échec de la requête VRM : {detail}',
    de: 'VRM-Anfrage fehlgeschlagen: {detail}',
    es: 'Error en la petición a VRM: {detail}',
  },
  errNoForecast: {
    en: 'VRM has no forecast for this installation.',
    fr: 'VRM n’a pas de prévision pour cette installation.',
    de: 'VRM hat keine Prognose für diese Anlage.',
    es: 'VRM no tiene previsión para esta instalación.',
  },

  // configuration buttons
  testOk: {
    en: 'Connected to VRM as {user}: {count} installation(s).',
    fr: 'Connecté à VRM en tant que {user} : {count} installation(s).',
    de: 'Mit VRM verbunden als {user}: {count} Anlage(n).',
    es: 'Conectado a VRM como {user}: {count} instalación(es).',
  },
  testLine: {
    en: '{name} (#{id}, data {ago})',
    fr: '{name} (n° {id}, données {ago})',
    de: '{name} (Nr. {id}, Daten {ago})',
    es: '{name} (n.º {id}, datos {ago})',
  },
  diagnosticDone: {
    en: 'Diagnostic written to the logs of the integration ({count} line(s)), without the token.',
    fr: 'Diagnostic écrit dans les journaux de l’intégration ({count} ligne(s)), sans le jeton.',
    de: 'Diagnose in die Logs der Integration geschrieben ({count} Zeile(n)), ohne das Token.',
    es: 'Diagnóstico escrito en los registros de la integración ({count} línea(s)), sin el token.',
  },

  // scene action texts (1000 at most)
  todaySummary: {
    en: 'Today: solar {solar} kWh, consumption {consumption} kWh, imported {import} kWh, exported {export} kWh, battery {soc}.',
    fr: 'Aujourd’hui : solaire {solar} kWh, consommation {consumption} kWh, importé {import} kWh, exporté {export} kWh, batterie {soc}.',
    de: 'Heute: Solar {solar} kWh, Verbrauch {consumption} kWh, bezogen {import} kWh, eingespeist {export} kWh, Batterie {soc}.',
    es: 'Hoy: solar {solar} kWh, consumo {consumption} kWh, importado {import} kWh, exportado {export} kWh, batería {soc}.',
  },
  forecastSummary: {
    en: 'Solar forecast: {today} kWh today ({left} kWh still to come), {tomorrow} kWh tomorrow. Consumption expected tomorrow: {consumption} kWh.',
    fr: 'Prévision solaire : {today} kWh aujourd’hui ({left} kWh restants), {tomorrow} kWh demain. Consommation attendue demain : {consumption} kWh.',
    de: 'Solarprognose: {today} kWh heute ({left} kWh noch erwartet), {tomorrow} kWh morgen. Erwarteter Verbrauch morgen: {consumption} kWh.',
    es: 'Previsión solar: {today} kWh hoy ({left} kWh pendientes), {tomorrow} kWh mañana. Consumo esperado mañana: {consumption} kWh.',
  },

  // how long ago
  never: { en: 'never', fr: 'jamais', de: 'nie', es: 'nunca' },
  justNow: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  minutesAgo: {
    en: '{n} min ago',
    fr: 'il y a {n} min',
    de: 'vor {n} Min.',
    es: 'hace {n} min',
  },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  daysAgo: { en: '{n} d ago', fr: 'il y a {n} j', de: 'vor {n} T.', es: 'hace {n} d' },
};

/**
 * @description Whether a value is a language of the integration.
 * @param {unknown} value - The value.
 * @returns {boolean} True for en, fr, de, es.
 */
function isLanguage(value) {
  return LANGUAGES.includes(value);
}

/**
 * @description A text in a language, with its values.
 * @param {string} key - A TEXTS key.
 * @param {string} language - The language (English when unknown).
 * @param {object} [values] - The values of the `{placeholders}`.
 * @returns {string} The text, the key itself when unknown.
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const template = entry[isLanguage(language) ? language : 'en'] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    values[name] === undefined || values[name] === null ? '' : String(values[name]),
  );
}

/**
 * @description A text in the four languages.
 * @param {string|Function} key - A TEXTS key, or `(language) => text`.
 * @param {object|Function} [values] - The values, or `(language) => values`.
 * @returns {object} `{ en, fr, de, es }`.
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      typeof key === 'function'
        ? key(language)
        : t(key, language, typeof values === 'function' ? values(language) : values),
    ]),
  );
}

/**
 * @description How long ago an instant was: "just now", "12 min ago", "3 h ago".
 * @param {number} at - The instant, in ms (0: never).
 * @param {number} now - Now, in ms.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function ago(at, now, language) {
  if (!at) {
    return t('never', language);
  }
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) {
    return t('justNow', language);
  }
  if (minutes < 60) {
    return t('minutesAgo', language, { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return t('hoursAgo', language, { n: hours });
  }
  return t('daysAgo', language, { n: Math.floor(hours / 24) });
}

/**
 * @description A number in the format of a language.
 * @param {number} value - The number.
 * @param {string} language - The language.
 * @param {number} [decimals] - The decimals at most.
 * @returns {string} "12,5" in French.
 */
function formatNumber(value, language, decimals = 1) {
  if (!Number.isFinite(value)) {
    return '–';
  }
  return new Intl.NumberFormat(isLanguage(language) ? language : 'en', {
    maximumFractionDigits: decimals,
  }).format(value);
}

export { LANGUAGES, TEXTS, isLanguage, t, all, ago, formatNumber };
