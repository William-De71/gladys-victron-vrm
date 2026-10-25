# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.2.0] - 2026-10-25

### Added

- require Gladys 5.3 and declare catalog keywords ([23e74fa](https://github.com/William-De71/gladys-victron-vrm/commit/23e74fa2d2742e44883c47df1c683fa7a95d147f))

## [0.1.0] - 2026-10-24

### Added

- **installations:** every Victron Energy installation of a VRM account, through the official VRM API v2 and a personal access token, read only; every installation read in one request (every 5 minutes by default), one request at a time, a pause honoring Retry-After when VRM answers 429
- **devices:** one device per installation: battery level, battery charge and discharge power and battery voltage, solar power and solar production of the day, signed grid power (import +, export −), AC loads and consumption of the day, generator power, without counting the house twice next to a Linky
- **scenes:** triggers when a VRM alarm is raised or cleared, when the battery is low (level of the configuration) or full, when the grid is lost or restored, when an installation stops sending data or comes back, and when VRM refuses the token; actions to read the energies of today and the solar and consumption forecasts of today and tomorrow
- **widgets:** the energy flow now (battery, solar, AC loads, grid, generator, alarms), today (energies, self-sufficiency, hourly chart), the VRM forecast (today, still to come, tomorrow, hourly chart) and the VRM alarm log
- **configuration:** access token with a guide, reading interval, battery low level, offline delay, "Test the connection" and "Diagnostic" buttons
- **i18n:** English, French, German and Spanish for the manifest, the runtime texts, the documentation and the README

[0.2.0]: https://github.com/William-De71/gladys-victron-vrm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/William-De71/gladys-victron-vrm/releases/tag/v0.1.0
