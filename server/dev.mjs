// Dev runner: rebuild the bundle on source changes and restart the server.
//
// We avoid `node --watch` because it relies on inotify events, which are
// unreliable across Docker bind mounts on Windows/macOS hosts (the same reason
// rspack is told to poll via CHOKIDAR_USEPOLLING). Instead we poll the built
// bundle with `fs.watchFile` and respawn Node whenever rspack rewrites it.
import { spawn } from 'node:child_process'
import { watchFile } from 'node:fs'
import { resolve } from 'node:path'

const bundle = resolve(import.meta.dirname, 'dist/index.cjs')
const polling = process.env.CHOKIDAR_USEPOLLING === 'true'

// Single source of truth: the CLI loads rspack.config.ts and watches sources.
const build = spawn('rspack', ['build', '--watch'], { stdio: 'inherit', shell: true })

let server
function restart() {
  if (server) server.kill()
  server = spawn('node', [bundle], { stdio: 'inherit' })
}

watchFile(bundle, { interval: polling ? 500 : 100 }, (curr, prev) => {
  if (curr.size > 0 && curr.mtimeMs !== prev.mtimeMs) restart()
})

function shutdown() {
  build.kill()
  if (server) server.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
