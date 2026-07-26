import { passportInstance, type PassportInstanceModels } from './instance-store'
import type { RecoveryModel } from './recovery-model'

/** Reatom defers disconnect cleanup to a microtask; let its queue drain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

function makeModels() {
  const teardown = vi.fn()
  const models = {
    recoveryModel: { teardown } as unknown as RecoveryModel,
  } as PassportInstanceModels
  return { models, teardown }
}

describe('passportInstance disposal', () => {
  it('tears the recovery session down when the last mount of an instance disconnects', async () => {
    // The safety net against leaking a live VNC session when the modal
    // outlived the widget: `dispose` must reach `recoveryModel.teardown()`.
    // Nothing else in the widget suite exercises that callback — with it
    // replaced by a no-op, every other test stays green.
    const { models, teardown } = makeModels()

    const handle = passportInstance('inst-dispose-teardown', () => models)
    const unsubscribe = handle.subscribe(() => {})
    await settle()

    // Still mounted — the session must be left alone.
    expect(teardown).not.toHaveBeenCalled()

    unsubscribe()
    await settle()

    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it('leaves the session alone while any mount of the instance is still connected', async () => {
    const { models, teardown } = makeModels()

    const handle = passportInstance('inst-dispose-two-mounts', () => models)
    const unsubscribeFirst = handle.subscribe(() => {})
    const unsubscribeSecond = handle.subscribe(() => {})
    await settle()

    unsubscribeFirst()
    await settle()
    expect(teardown).not.toHaveBeenCalled()

    unsubscribeSecond()
    await settle()
    expect(teardown).toHaveBeenCalledTimes(1)
  })
})
