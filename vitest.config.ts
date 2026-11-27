import { defineConfig } from 'vitest/config'

// The whole workspace runs as ONE Vitest process with one shared worker pool.
//
// It used to be `pnpm -r test`: up to four packages at once, each spawning its
// own Vitest with its own pool sized to the whole machine — ~28 workers on 8
// cores, before `pnpm check` added typecheck on top. Every timeout-shaped flake
// (a different 5 s test on each run) was that oversubscription. A single pool
// keeps the worker count at the CPU count no matter how many packages exist.
//
// Why the pool stays `forks` (the default) although `vmForks` halves the jsdom
// projects' wall time on Windows (a cold `require('jsdom')` costs 3-4 s per
// file there): VM pools run test code in a separate realm, so an error thrown
// by a Node builtin (fs, fetch, crypto) fails `instanceof Error` — and
// `errore.try`/`tryAsync` rethrow anything that does. Tests would then check
// different error semantics than production runs. Measured, not guessed: the
// widget-sdk fs-error test fails under vmForks.
//
// Each package keeps its own config (environment, aliases, setup files) as a
// project; `pnpm --filter <pkg> test` still runs one package on its own, and
// `vitest run --project <name>` does the same from here.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'scripts',
          include: ['scripts/**/*.test.ts'],
          environment: 'node',
        },
      },
      // Config files, not directories: a directory glob also matches stray
      // files such as packages/widgets/.ports.json and Vitest rejects them.
      'packages/client/vite.config.ts',
      'packages/*/vitest.config.ts',
      'packages/modules/*/vitest.config.ts',
      'packages/widgets/*/vitest.config.ts',
    ],
  },
})
