import type { WidgetApi } from '@shared/widgets/contracts'
import { WidgetApiError } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

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
    storage: createFakeStorage(),
  })
  const teardown = vi.fn()
  const recoveryModel = { teardown } as unknown as RecoveryModel
  const flow = makeRecoveryFlow({ checkModel, recoveryModel })
  return { checkModel, flow, teardown, invoke }
}

describe('makeRecoveryFlow', () => {
  it('opens the modal surface for the tile', () => {
    const { checkModel, flow } = setup()

    flow.openRecovery({ surface: 'modal' })

    expect(checkModel.recoveryOpen()).toBe(true)
    expect(checkModel.recoverySurface()).toBe('modal')
  })

  it('opens the inline surface for fullscreen', () => {
    const { checkModel, flow } = setup()

    flow.openRecovery({ surface: 'inline' })

    expect(checkModel.recoveryOpen()).toBe(true)
    expect(checkModel.recoverySurface()).toBe('inline')
  })

  it('tears down and clears both flags on close, regardless of surface', () => {
    const { checkModel, flow, teardown } = setup()

    flow.openRecovery({ surface: 'inline' })
    flow.closeRecovery()

    expect(teardown).toHaveBeenCalledTimes(1)
    expect(checkModel.recoveryOpen()).toBe(false)
    expect(checkModel.recoverySurface()).toBeNull()
  })

  it('tears down, clears both flags, and re-runs the check on retry', async () => {
    const { checkModel, flow, invoke, teardown } = setup()

    flow.openRecovery({ surface: 'modal' })
    flow.retryCheck()

    expect(checkModel.recoveryOpen()).toBe(false)
    expect(checkModel.recoverySurface()).toBeNull()
    expect(teardown).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
  })
})
