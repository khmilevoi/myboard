#!/usr/bin/env node
// `vite build` (the CLI) still never returns control on this stack even after
// upgrading to vite 8.1.2 / rolldown 1.1.3. Direct testing showed the widget
// CLI build prints `✓ built` and then hangs when `@module-federation/vite` is
// enabled, while the same widget build exits normally once the federation
// plugin is removed from the config. The client-side PWA plugin could not be
// isolated the same way because removing it breaks the app's
// `virtual:pwa-register` import before the exit behavior can be measured.
// Calling `build()` from the Node API and exiting once it resolves sidesteps
// the stuck CLI process — unlike a plugin hook, this only runs after the whole
// pipeline (including parallel `closeBundle` hooks) has actually finished.
import { build } from 'vite'

try {
  await build()
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
