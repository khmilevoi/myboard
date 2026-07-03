import { describe, expect, it } from 'vitest'

describe('widget-runtime package exports', () => {
  it('resolves the public barrel and explicit test subpaths', async () => {
    const runtime = await import('widget-runtime')
    const storageFakes = await import('widget-runtime/storage/test/fakes')
    const timerFakes = await import('widget-runtime/timer/fakes')

    expect(runtime.DEFAULT_TIERS.standard.minWidthPx).toBeGreaterThan(0)
    expect(runtime.makeWidgetStorage).toBeTypeOf('function')
    expect(runtime.makeWidgetApi).toBeTypeOf('function')
    expect(runtime.getServerTime).toBeTypeOf('function')
    expect(runtime.useWidgetContext).toBeTypeOf('function')
    expect(runtime.WidgetRuntimeContext.Provider).toBeDefined()
    expect(storageFakes.createFakeStorage).toBeTypeOf('function')
    expect(timerFakes.createFakeTimer).toBeTypeOf('function')
  })
})
