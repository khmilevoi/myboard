#!/usr/bin/env node
// `vite build` (the CLI) never returns control on this stack: Rolldown's
// native thread pool keeps the process alive after the build finishes even
// though Vite's own `build()` promise has resolved (confirmed via
// why-is-node-running: zero JS-level handles remain). Calling `build()`
// from the Node API and exiting once it resolves sidesteps that — unlike a
// plugin hook, this only runs after the whole pipeline (including parallel
// `closeBundle` hooks like the PWA plugin's) has actually finished.
import { build } from 'vite'

try {
  await build()
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
