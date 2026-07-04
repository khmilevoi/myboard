import { makeChromiumExecutor } from './browser/chromium-executor'
import { loadBrowserServiceConfig } from './config'
import { makeBrowserHttpApp } from './http/app'
import { makeBrowserService } from './service'
import { composeBrowserRegistry } from './tasks/compose'
import { widgetBrowserList } from './tasks/widget-browser-list.generated'

const config = loadBrowserServiceConfig(process.env)
if (config instanceof Error) {
  console.error(config.message)
  process.exit(1)
}

const registry = composeBrowserRegistry(widgetBrowserList)
if (registry instanceof Error) {
  console.error(registry.message)
  process.exit(1)
}

const executor = makeChromiumExecutor({
  profileDir: config.profileDir,
  secretsDir: config.secretsDir,
})
const service = makeBrowserService({ registry, executor, config })
const app = makeBrowserHttpApp(service)

app.server.listen(config.port, () => {
  service.markReady()
  console.log(`browser-automation listening on :${config.port}`)
})

process.on('SIGTERM', () => {
  void service.shutdown().then(() => app.close())
})
process.on('SIGINT', () => {
  void service.shutdown().then(() => app.close())
})
