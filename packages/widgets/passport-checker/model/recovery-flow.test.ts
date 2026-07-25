import type { WidgetApi } from '@shared/widgets/contracts'
import { WidgetApiError } from 'widget-runtime'

import type { PassportCheckerEvents } from '../types'
import { makePassportCheckModel } from './check-model'
import { makeRecoveryFlow } from './recovery-flow'
import type { RecoveryModel } from './recovery-model'

function setup() {
  const invoke = vi.fn(
    async () => new WidgetApiError({ reason: 'x', code: 'browser_session_required' }),
  )
  const checkModel = makePassportCheckModel({
    api: { invoke } as unknown as WidgetApi<PassportCheckerEvents, WidgetApiError>,
  })
  const teardown = vi.fn()
  const recoveryModel = { teardown } as unknown as RecoveryModel
  const flow = makeRecoveryFlow({ checkModel, recoveryModel })
  return { checkModel, flow, teardown, invoke }
}

describe('makeRecoveryFlow', () => {
  it('collapses fullscreen when recovery opens from the fullscreen mount', () => {
    const { checkModel, flow } = setup()
    const collapse = vi.fn()

    flow.openRecovery({ fromFullscreen: true, collapse })

    expect(checkModel.recoveryOpen()).toBe(true)
    expect(collapse).toHaveBeenCalledTimes(1)
  })

  it('does not collapse when recovery opens from the tile', () => {
    const { checkModel, flow } = setup()
    const collapse = vi.fn()

    flow.openRecovery({ fromFullscreen: false, collapse })

    expect(checkModel.recoveryOpen()).toBe(true)
    expect(collapse).not.toHaveBeenCalled()
  })

  it('restores fullscreen on close only when it collapsed it', () => {
    const { flow, teardown } = setup()
    const restore = vi.fn()

    flow.openRecovery({ fromFullscreen: true, collapse: vi.fn() })
    flow.closeRecovery({ restore })

    expect(teardown).toHaveBeenCalledTimes(1)
    expect(restore).toHaveBeenCalledTimes(1)

    flow.openRecovery({ fromFullscreen: false, collapse: vi.fn() })
    flow.closeRecovery({ restore })

    expect(restore).toHaveBeenCalledTimes(1)
  })

  it('restores at most once per collapse', () => {
    const { flow } = setup()
    const restore = vi.fn()

    flow.openRecovery({ fromFullscreen: true, collapse: vi.fn() })
    flow.closeRecovery({ restore })
    flow.closeRecovery({ restore })

    expect(restore).toHaveBeenCalledTimes(1)
  })

  it('restores fullscreen and re-runs the check on retry', async () => {
    const { checkModel, flow, invoke, teardown } = setup()
    const restore = vi.fn()

    flow.openRecovery({ fromFullscreen: true, collapse: vi.fn() })
    flow.retryCheck({ restore })

    expect(checkModel.recoveryOpen()).toBe(false)
    expect(teardown).toHaveBeenCalledTimes(1)
    expect(restore).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
  })
})
