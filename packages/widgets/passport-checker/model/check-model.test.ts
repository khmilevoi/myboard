import { context, wrap } from '@reatom/core'
import type { WidgetApi } from '@shared/widgets/contracts'
import { WidgetApiError } from 'widget-runtime'
import type { StorageApi } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import type { PassportCheckerEvents } from '../types'
import {
  CHECK_DEADLINE_MS,
  GENERIC_RETRYABLE_MESSAGE,
  formatCheckedAt,
  lastResultSchema,
  makePassportCheckModel,
  mapCheckError,
  PASSPORT_LAST_RESULT_KEY,
  RETRYABLE_MESSAGES,
} from './check-model'

type CheckResult = { status: number; send_status_msg: string }

function makeApi() {
  const invoke =
    vi.fn<
      (event: 'check', payload: Record<string, never>) => Promise<WidgetApiError | CheckResult>
    >()
  const api = { invoke } as unknown as WidgetApi<PassportCheckerEvents, WidgetApiError>
  return { api, invoke }
}

function apiError(code: string, meta?: Record<string, unknown>) {
  return new WidgetApiError({ reason: `${code}: message`, code, meta })
}

afterEach(() => {
  vi.useRealTimers()
  context.reset()
})

describe('mapCheckError', () => {
  it.each([
    ['browser_unavailable', RETRYABLE_MESSAGES.browser_unavailable],
    ['automation_timeout', RETRYABLE_MESSAGES.automation_timeout],
    ['upstream_response', RETRYABLE_MESSAGES.upstream_response],
    ['invalid_checker_response', RETRYABLE_MESSAGES.invalid_checker_response],
    ['automation_protocol', RETRYABLE_MESSAGES.automation_protocol],
    ['network', GENERIC_RETRYABLE_MESSAGE],
    ['some_future_code', GENERIC_RETRYABLE_MESSAGE],
  ])('maps %s to a retryable view', (code, message) => {
    expect(mapCheckError(apiError(code))).toEqual({ kind: 'retryable', message })
  })

  // Hardcodes the expected string instead of reading RETRYABLE_MESSAGES.user_input_probe:
  // the entry has already vanished from the table twice without any test turning red,
  // because a table-sourced expectation just compares the map against itself. If the
  // entry is missing, mapCheckError silently falls back to GENERIC_RETRYABLE_MESSAGE and
  // the user sees "Не удалось выполнить проверку" instead of the specific text below.
  it('maps user_input_probe to its specific retryable message', () => {
    expect(mapCheckError(apiError('user_input_probe'))).toEqual({
      kind: 'retryable',
      message: 'Не удалось проверить состояние браузера',
    })
  })

  it('maps browser_session_required with sshTarget and novncPort', () => {
    expect(
      mapCheckError(
        apiError('browser_session_required', { sshTarget: 'admin@pi', novncPort: 16080 }),
      ),
    ).toEqual({
      kind: 'sessionRequired',
      sshTarget: 'admin@pi',
      novncPort: 16080,
    })
  })

  it('maps browser_session_required without sshTarget or novncPort to null/default', () => {
    expect(mapCheckError(apiError('browser_session_required'))).toEqual({
      kind: 'sessionRequired',
      sshTarget: null,
      novncPort: 6080,
    })
  })

  it('maps browser_configuration to invalidConfig', () => {
    expect(mapCheckError(apiError('browser_configuration'))).toEqual({ kind: 'invalidConfig' })
  })
})

describe('CHECK_DEADLINE_MS', () => {
  // Mirrors packages/browser-automation/src/config.ts's ConfigSchema
  // defaults (BROWSER_QUEUE_WAIT_MS + BROWSER_TASK_TIMEOUT_MS) and
  // docker-compose.yml's board-server BROWSER_AUTOMATION_TIMEOUT_MS. Not
  // imported directly — passport-checker's model does not depend on either
  // package — so if those numbers move, this test (and the derivation
  // comment on CHECK_DEADLINE_MS) must be updated by hand rather than
  // silently drifting apart.
  const SERVER_PIPELINE_BUDGET_MS = 30_000 + 60_000
  const SERVER_HTTP_TIMEOUT_MS = 100_000

  it('sits above the server pipeline budget and below the server HTTP timeout', () => {
    expect(CHECK_DEADLINE_MS).toBeGreaterThan(SERVER_PIPELINE_BUDGET_MS)
    expect(CHECK_DEADLINE_MS).toBeLessThan(SERVER_HTTP_TIMEOUT_MS)
  })
})

describe('formatCheckedAt', () => {
  it('renders only the time when the check happened today', () => {
    expect(
      formatCheckedAt(new Date('2026-07-24T13:07:00').getTime(), new Date('2026-07-24T21:40:00')),
    ).toBe('13:07')
  })

  it('renders the date when the check happened on another day', () => {
    expect(
      formatCheckedAt(new Date('2026-07-24T13:07:00').getTime(), new Date('2026-07-26T09:00:00')),
    ).toBe('24.07 13:07')
  })

  it('renders the date for a check exactly 24 hours old', () => {
    expect(
      formatCheckedAt(new Date('2026-07-25T13:07:00').getTime(), new Date('2026-07-26T13:07:00')),
    ).toBe('25.07 13:07')
  })

  it('pads single-digit days, months, hours and minutes', () => {
    expect(
      formatCheckedAt(new Date('2026-08-03T09:05:00').getTime(), new Date('2026-08-04T10:00:00')),
    ).toBe('03.08 09:05')
  })
})

describe('makePassportCheckModel', () => {
  it('goes idle -> pending -> success with a local HH:MM stamp', async () => {
    const { api, invoke } = makeApi()
    let resolveInvoke: (value: WidgetApiError | CheckResult) => void = () => {}
    invoke.mockReturnValueOnce(
      new Promise<WidgetApiError | CheckResult>((resolve) => {
        resolveInvoke = resolve
      }),
    )

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage: createFakeStorage(),
        now: () => new Date('2026-07-24T13:07:00'),
      })
      const read = wrap(() => model.viewState())
      expect(read()).toEqual({ kind: 'idle' })

      const run = wrap(() => model.checkPassport())
      const pending = run()
      expect(read()).toEqual({ kind: 'pending' })

      resolveInvoke({ status: 200, send_status_msg: 'Документ готовий' })
      await pending

      expect(read()).toEqual({
        kind: 'success',
        status: 200,
        message: 'Документ готовий',
        checkedAtLabel: '13:07',
      })
    })
  })

  it('ignores a duplicate submit while pending', async () => {
    const { api, invoke } = makeApi()
    let resolveInvoke: (value: WidgetApiError | CheckResult) => void = () => {}
    invoke.mockReturnValueOnce(
      new Promise<WidgetApiError | CheckResult>((resolve) => {
        resolveInvoke = resolve
      }),
    )

    await context.start(async () => {
      const model = makePassportCheckModel({ api, storage: createFakeStorage() })
      const run = wrap(() => model.checkPassport())

      const first = run()
      const second = run()
      expect(invoke).toHaveBeenCalledTimes(1)

      resolveInvoke({ status: 200, send_status_msg: 'ok' })
      await Promise.all([first, second])
    })
  })

  it('maps an error code to its view state', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(apiError('browser_session_required', { sshTarget: 'admin@pi' }))

    await context.start(async () => {
      const model = makePassportCheckModel({ api, storage: createFakeStorage() })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())

      await run()

      expect(read()).toEqual({ kind: 'sessionRequired', sshTarget: 'admin@pi', novncPort: 6080 })
    })
  })

  it('settles to the timeout view when the deadline fires first', async () => {
    vi.useFakeTimers()
    const { api, invoke } = makeApi()
    invoke.mockReturnValueOnce(new Promise<never>(() => {}))

    await context.start(async () => {
      const model = makePassportCheckModel({ api, storage: createFakeStorage(), deadlineMs: 1_000 })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())

      const pending = run()
      await vi.advanceTimersByTimeAsync(1_000)
      await pending

      expect(read()).toEqual({
        kind: 'retryable',
        message: RETRYABLE_MESSAGES.automation_timeout,
      })
    })
  })

  it('lands a late success: an invoke that resolves after the deadline still writes lastResult and clears the transient error', async () => {
    const { api, invoke } = makeApi()
    let resolveInvoke: (value: WidgetApiError | CheckResult) => void = () => {}
    invoke.mockReturnValueOnce(
      new Promise<WidgetApiError | CheckResult>((resolve) => {
        resolveInvoke = resolve
      }),
    )

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage: createFakeStorage(),
        deadlineMs: 0,
        now: () => new Date('2026-07-24T13:07:00'),
      })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())

      // The 0ms deadline wins the race first, same as the existing "fires
      // first" test above — the pipeline itself is still running.
      await run()
      expect(read()).toEqual({
        kind: 'retryable',
        message: RETRYABLE_MESSAGES.automation_timeout,
      })

      // A real result arrives after the fact. It must not be silently
      // dropped: the passport status is a fact the user still needs.
      resolveInvoke({ status: 200, send_status_msg: 'Документ готовий' })
      await vi.waitFor(() => {
        expect(read()).toEqual({
          kind: 'success',
          status: 200,
          message: 'Документ готовий',
          checkedAtLabel: '13:07',
        })
      })
    })
  })

  it('does not let a late straggler from a superseded attempt overwrite a newer, already-observed result', async () => {
    const { api, invoke } = makeApi()
    let resolveFirst: (value: WidgetApiError | CheckResult) => void = () => {}
    invoke.mockReturnValueOnce(
      new Promise<WidgetApiError | CheckResult>((resolve) => {
        resolveFirst = resolve
      }),
    )
    invoke.mockResolvedValueOnce({ status: 200, send_status_msg: 'Документ готовий' })

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage: createFakeStorage(),
        deadlineMs: 0,
        now: () => new Date('2026-07-24T13:07:00'),
      })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())

      // Attempt A: the 0ms deadline wins immediately, same as the "fires
      // first" test above — the underlying invoke is still running.
      await run()
      expect(read()).toEqual({
        kind: 'retryable',
        message: RETRYABLE_MESSAGES.automation_timeout,
      })

      // The user retries. Attempt B (mocked second) resolves and completes
      // normally, taking transient back to idle with the newer result.
      await run()
      expect(read()).toEqual({
        kind: 'success',
        status: 200,
        message: 'Документ готовий',
        checkedAtLabel: '13:07',
      })

      // Attempt A's invoke finally settles — a straggler from an attempt the
      // user has already moved past. It must not overwrite the newer result,
      // even though transient is idle (not pending) at this point.
      resolveFirst({ status: 102, send_status_msg: 'В обробці' })
      await Promise.resolve()
      await Promise.resolve()

      expect(read()).toEqual({
        kind: 'success',
        status: 200,
        message: 'Документ готовий',
        checkedAtLabel: '13:07',
      })
    })
  })

  it('starts with the recovery modal closed', () => {
    const { api } = makeApi()
    const model = makePassportCheckModel({ api, storage: createFakeStorage() })
    expect(model.recoveryOpen()).toBe(false)
  })
})

const STORED = {
  status: 200,
  message: 'Документ готовий',
  checkedAt: new Date('2026-07-24T13:07:00').getTime(),
}

async function seed(storage: StorageApi) {
  const result = await storage.set(PASSPORT_LAST_RESULT_KEY, STORED)
  if (result instanceof Error) throw result
}

describe('lastResultSchema', () => {
  // Every other test in this file goes through createFakeStorage, which
  // explicitly skips schema validation (see its fakes), so on the real HTTP
  // backend this schema is a production-only path. This is the one place it
  // actually runs, over the exact object shape `succeed` builds in
  // checkPassport: { status, message, checkedAt }.
  it('parses the shape a successful check writes', () => {
    expect(lastResultSchema.safeParse(STORED).success).toBe(true)
  })
})

describe('PASSPORT_LAST_RESULT_KEY', () => {
  // Every test in this file reaches storage through the constant, never the
  // literal, so a silent rename here would keep the suite green while
  // orphaning every deployed user's stored result under the old key (see
  // CLAUDE.md's storage-keys-are-a-persistence-contract warning).
  it('is the literal storage key', () => {
    expect(PASSPORT_LAST_RESULT_KEY).toBe('lastResult')
  })
})

describe('makePassportCheckModel persistence', () => {
  it('writes a successful check to the shared key', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce({ status: 200, send_status_msg: 'Документ готовий' })
    const storage = createFakeStorage()

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date('2026-07-24T13:07:00'),
      })
      const run = wrap(() => model.checkPassport())
      await run()
    })

    // The change hook that performs the write is flushed on a microtask, so the
    // value is not in the fake the instant `checkPassport` resolves.
    await vi.waitFor(async () => {
      expect(await storage.get(PASSPORT_LAST_RESULT_KEY)).toEqual(STORED)
    })
  })

  it('restores a stored result into the view state without checking', async () => {
    const { api, invoke } = makeApi()
    const storage = createFakeStorage()
    await seed(storage)

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date('2026-07-24T21:40:00'),
      })
      const read = wrap(() => model.viewState())
      // withStorageKey subscribes from a connect hook, so the atom only reads
      // storage while something is subscribed to it.
      const unsubscribe = model.viewState.subscribe(() => {})

      await vi.waitFor(() => {
        expect(read()).toEqual({
          kind: 'success',
          status: 200,
          message: 'Документ готовий',
          checkedAtLabel: '13:07',
        })
      })

      unsubscribe()
    })

    expect(invoke).not.toHaveBeenCalled()
  })

  it('dates a restored result taken on an earlier day', async () => {
    const { api } = makeApi()
    const storage = createFakeStorage()
    await seed(storage)

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date('2026-07-26T09:00:00'),
      })
      const read = wrap(() => model.viewState())
      const unsubscribe = model.viewState.subscribe(() => {})

      await vi.waitFor(() => {
        expect(read()).toMatchObject({ kind: 'success', checkedAtLabel: '24.07 13:07' })
      })

      unsubscribe()
    })
  })

  it('shows a failed check without erasing the stored result', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(apiError('browser_unavailable'))
    const storage = createFakeStorage()
    await seed(storage)

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date('2026-07-24T21:40:00'),
      })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())
      const unsubscribe = model.viewState.subscribe(() => {})

      await run()

      expect(read()).toEqual({
        kind: 'retryable',
        message: RETRYABLE_MESSAGES.browser_unavailable,
      })
      unsubscribe()
    })

    expect(await storage.get(PASSPORT_LAST_RESULT_KEY)).toEqual(STORED)
  })
})
