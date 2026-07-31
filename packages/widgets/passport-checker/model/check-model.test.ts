import { context, wrap } from '@reatom/core'
import type { WidgetApi } from '@shared/widgets/contracts'
import { StorageError, WidgetApiError } from 'widget-runtime'
import type { StorageApi } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import type { PassportCheckerEvents, PassportCheckResult } from '../types'
import {
  CHECK_DEADLINE_MS,
  GENERIC_RETRYABLE_MESSAGE,
  formatCheckedAt,
  lastResultSchema,
  mergeCheckResult,
  makePassportCheckModel,
  mapCheckError,
  normalizeStoredResult,
  PASSPORT_LAST_RESULT_KEY,
  RETRYABLE_MESSAGES,
} from './check-model'

type CheckResult = PassportCheckResult

const TWO_SUCCESSES: PassportCheckResult = {
  idCard: { kind: 'success', status: 200, send_status_msg: 'ID готова' },
  internationalPassport: {
    kind: 'success',
    status: 201,
    send_status_msg: 'Загран готов',
  },
}

const LEGACY_STORED = {
  status: 200,
  message: 'Старый ID результат',
  checkedAt: new Date('2026-07-24T13:07:00').getTime(),
}

const V2_STORED = {
  version: 2 as const,
  idCard: {
    status: 200,
    message: 'ID сохранена',
    checkedAt: new Date('2026-07-24T13:07:00').getTime(),
  },
  internationalPassport: {
    status: 201,
    message: 'Загран сохранён',
    checkedAt: new Date('2026-07-23T09:05:00').getTime(),
  },
}

const ID_SUCCESS_PASSPORT_ERROR: PassportCheckResult = {
  idCard: { kind: 'success', status: 202, send_status_msg: 'Новый ID результат' },
  internationalPassport: { kind: 'error', code: 'upstream_response' },
}

const ID_ERROR_PASSPORT_SUCCESS: PassportCheckResult = {
  idCard: { kind: 'error', code: 'invalid_checker_response' },
  internationalPassport: {
    kind: 'success',
    status: 203,
    send_status_msg: 'Новый загран результат',
  },
}

const TWO_ERRORS: PassportCheckResult = {
  idCard: { kind: 'error', code: 'invalid_checker_response' },
  internationalPassport: { kind: 'error', code: 'upstream_response' },
}

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
  it('goes idle -> pending -> results with local HH:MM stamps', async () => {
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

      resolveInvoke(TWO_SUCCESSES)
      await pending

      expect(read()).toEqual({
        kind: 'results',
        idCard: {
          kind: 'success',
          status: 200,
          message: 'ID готова',
          checkedAtLabel: '13:07',
        },
        internationalPassport: {
          kind: 'success',
          status: 201,
          message: 'Загран готов',
          checkedAtLabel: '13:07',
        },
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

      resolveInvoke(TWO_SUCCESSES)
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
      resolveInvoke(TWO_SUCCESSES)
      await vi.waitFor(() => {
        expect(read()).toEqual({
          kind: 'results',
          idCard: {
            kind: 'success',
            status: 200,
            message: 'ID готова',
            checkedAtLabel: '13:07',
          },
          internationalPassport: {
            kind: 'success',
            status: 201,
            message: 'Загран готов',
            checkedAtLabel: '13:07',
          },
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
    invoke.mockResolvedValueOnce(TWO_SUCCESSES)

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
        kind: 'results',
        idCard: {
          kind: 'success',
          status: 200,
          message: 'ID готова',
          checkedAtLabel: '13:07',
        },
        internationalPassport: {
          kind: 'success',
          status: 201,
          message: 'Загран готов',
          checkedAtLabel: '13:07',
        },
      })

      // Attempt A's invoke finally settles — a straggler from an attempt the
      // user has already moved past. It must not overwrite the newer result,
      // even though transient is idle (not pending) at this point.
      resolveFirst({
        idCard: { kind: 'success', status: 102, send_status_msg: 'Старый ID' },
        internationalPassport: {
          kind: 'success',
          status: 103,
          send_status_msg: 'Старый загран',
        },
      })
      await Promise.resolve()
      await Promise.resolve()

      expect(read()).toEqual({
        kind: 'results',
        idCard: {
          kind: 'success',
          status: 200,
          message: 'ID готова',
          checkedAtLabel: '13:07',
        },
        internationalPassport: {
          kind: 'success',
          status: 201,
          message: 'Загран готов',
          checkedAtLabel: '13:07',
        },
      })
    })
  })

  it('starts with the recovery modal closed', () => {
    const { api } = makeApi()
    const model = makePassportCheckModel({ api, storage: createFakeStorage() })
    expect(model.recoveryOpen()).toBe(false)
  })
})

async function seed(storage: StorageApi, value: unknown) {
  const result = await storage.set(PASSPORT_LAST_RESULT_KEY, value)
  if (result instanceof Error) throw result
}

describe('lastResultSchema', () => {
  // Every other test in this file goes through createFakeStorage, which
  // explicitly skips schema validation (see its fakes), so on the real HTTP
  // backend this schema is a production-only path. This is the one place it
  // actually runs over both persisted generations.
  it('accepts legacy and partial or complete v2 stored values', () => {
    expect(lastResultSchema.safeParse(LEGACY_STORED).success).toBe(true)
    expect(lastResultSchema.safeParse(V2_STORED).success).toBe(true)
    expect(lastResultSchema.safeParse({ version: 2, idCard: V2_STORED.idCard }).success).toBe(true)
  })

  it('normalizes a legacy result to an in-memory v2 ID-card result', () => {
    expect(normalizeStoredResult(LEGACY_STORED)).toEqual({
      version: 2,
      idCard: LEGACY_STORED,
    })
  })
})

describe('mergeCheckResult', () => {
  const observationTime = new Date('2026-07-24T13:07:00').getTime()

  it('replaces both stored documents from two successes at one observation time', () => {
    expect(
      mergeCheckResult({ stored: V2_STORED, result: TWO_SUCCESSES, checkedAt: observationTime }),
    ).toEqual({
      stored: {
        version: 2,
        idCard: { status: 200, message: 'ID готова', checkedAt: observationTime },
        internationalPassport: {
          status: 201,
          message: 'Загран готов',
          checkedAt: observationTime,
        },
      },
      errors: {},
    })
  })

  it('updates only ID card and preserves a failed international passport', () => {
    expect(
      mergeCheckResult({
        stored: V2_STORED,
        result: ID_SUCCESS_PASSPORT_ERROR,
        checkedAt: observationTime,
      }),
    ).toEqual({
      stored: {
        version: 2,
        idCard: { status: 202, message: 'Новый ID результат', checkedAt: observationTime },
        internationalPassport: V2_STORED.internationalPassport,
      },
      errors: {
        internationalPassport: {
          kind: 'retryable',
          message: 'Сервис проверки временно недоступен',
        },
      },
    })
  })

  it('updates only international passport and preserves a failed ID card', () => {
    expect(
      mergeCheckResult({
        stored: V2_STORED,
        result: ID_ERROR_PASSPORT_SUCCESS,
        checkedAt: observationTime,
      }),
    ).toEqual({
      stored: {
        version: 2,
        idCard: V2_STORED.idCard,
        internationalPassport: {
          status: 203,
          message: 'Новый загран результат',
          checkedAt: observationTime,
        },
      },
      errors: {
        idCard: {
          kind: 'retryable',
          message: 'Сервис проверки вернул неожиданный ответ',
        },
      },
    })
  })

  it('returns no stored write when both documents fail', () => {
    expect(
      mergeCheckResult({ stored: V2_STORED, result: TWO_ERRORS, checkedAt: observationTime }),
    ).toEqual({
      stored: null,
      errors: {
        idCard: {
          kind: 'retryable',
          message: 'Сервис проверки вернул неожиданный ответ',
        },
        internationalPassport: {
          kind: 'retryable',
          message: 'Сервис проверки временно недоступен',
        },
      },
    })
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
  it('writes two successful documents to the shared key', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(TWO_SUCCESSES)
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
      expect(await storage.get(PASSPORT_LAST_RESULT_KEY)).toEqual({
        version: 2,
        idCard: {
          status: 200,
          message: 'ID готова',
          checkedAt: new Date('2026-07-24T13:07:00').getTime(),
        },
        internationalPassport: {
          status: 201,
          message: 'Загран готов',
          checkedAt: new Date('2026-07-24T13:07:00').getTime(),
        },
      })
    })
  })

  it('hydrates a legacy ID-card result without an RPC or migration write', async () => {
    const { api, invoke } = makeApi()
    const storage = createFakeStorage()
    const setSpy = vi.spyOn(storage, 'set')
    await seed(storage, LEGACY_STORED)
    setSpy.mockClear()

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
          kind: 'results',
          idCard: {
            kind: 'success',
            status: 200,
            message: 'Старый ID результат',
            checkedAtLabel: '13:07',
          },
          internationalPassport: { kind: 'unchecked' },
        })
      })

      unsubscribe()
    })

    expect(invoke).not.toHaveBeenCalled()
    expect(setSpy).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'only ID card',
      stored: { version: 2 as const, idCard: V2_STORED.idCard },
      expected: {
        kind: 'results',
        idCard: {
          kind: 'success',
          status: 200,
          message: 'ID сохранена',
          checkedAtLabel: '13:07',
        },
        internationalPassport: { kind: 'unchecked' },
      },
    },
    {
      name: 'only international passport',
      stored: {
        version: 2 as const,
        internationalPassport: V2_STORED.internationalPassport,
      },
      expected: {
        kind: 'results',
        idCard: { kind: 'unchecked' },
        internationalPassport: {
          kind: 'success',
          status: 201,
          message: 'Загран сохранён',
          checkedAtLabel: '23.07 09:05',
        },
      },
    },
    {
      name: 'both documents',
      stored: V2_STORED,
      expected: {
        kind: 'results',
        idCard: {
          kind: 'success',
          status: 200,
          message: 'ID сохранена',
          checkedAtLabel: '13:07',
        },
        internationalPassport: {
          kind: 'success',
          status: 201,
          message: 'Загран сохранён',
          checkedAtLabel: '23.07 09:05',
        },
      },
    },
  ])('hydrates v2 with $name', async ({ stored, expected }) => {
    const { api, invoke } = makeApi()
    const storage = createFakeStorage()
    await seed(storage, stored)

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date('2026-07-24T21:40:00'),
      })
      const read = wrap(() => model.viewState())
      const unsubscribe = model.viewState.subscribe(() => {})

      await vi.waitFor(() => {
        expect(read()).toEqual(expected)
      })

      unsubscribe()
    })

    expect(invoke).not.toHaveBeenCalled()
  })

  it('merges an ID success, preserves and masks the failed stored international passport', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(ID_SUCCESS_PASSPORT_ERROR)
    const storage = createFakeStorage()
    await seed(storage, V2_STORED)
    const observationTime = new Date('2026-07-24T13:07:00').getTime()

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date(observationTime),
      })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())
      const unsubscribe = model.viewState.subscribe(() => {})
      await vi.waitFor(() => expect(read().kind).toBe('results'))

      await run()

      expect(read()).toEqual({
        kind: 'results',
        idCard: {
          kind: 'success',
          status: 202,
          message: 'Новый ID результат',
          checkedAtLabel: '13:07',
        },
        internationalPassport: {
          kind: 'retryable',
          message: RETRYABLE_MESSAGES.upstream_response,
        },
      })
      unsubscribe()
    })

    await vi.waitFor(async () => {
      expect(await storage.get(PASSPORT_LAST_RESULT_KEY)).toEqual({
        version: 2,
        idCard: {
          status: 202,
          message: 'Новый ID результат',
          checkedAt: observationTime,
        },
        internationalPassport: V2_STORED.internationalPassport,
      })
    })
  })

  it('merges an international-passport success, preserves and masks the failed stored ID card', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(ID_ERROR_PASSPORT_SUCCESS)
    const storage = createFakeStorage()
    await seed(storage, V2_STORED)
    const observationTime = new Date('2026-07-24T13:07:00').getTime()

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date(observationTime),
      })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())
      const unsubscribe = model.viewState.subscribe(() => {})
      await vi.waitFor(() => expect(read().kind).toBe('results'))

      await run()

      expect(read()).toEqual({
        kind: 'results',
        idCard: {
          kind: 'retryable',
          message: RETRYABLE_MESSAGES.invalid_checker_response,
        },
        internationalPassport: {
          kind: 'success',
          status: 203,
          message: 'Новый загран результат',
          checkedAtLabel: '13:07',
        },
      })
      unsubscribe()
    })

    await vi.waitFor(async () => {
      expect(await storage.get(PASSPORT_LAST_RESULT_KEY)).toEqual({
        version: 2,
        idCard: V2_STORED.idCard,
        internationalPassport: {
          status: 203,
          message: 'Новый загран результат',
          checkedAt: observationTime,
        },
      })
    })
  })

  it('does not write or delete storage when both documents fail', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(TWO_ERRORS)
    const storage = createFakeStorage()
    const setSpy = vi.spyOn(storage, 'set')
    await seed(storage, V2_STORED)
    setSpy.mockClear()

    await context.start(async () => {
      const model = makePassportCheckModel({ api, storage })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())
      const unsubscribe = model.viewState.subscribe(() => {})
      await vi.waitFor(() => expect(read().kind).toBe('results'))

      await run()

      expect(read()).toEqual({
        kind: 'results',
        idCard: {
          kind: 'retryable',
          message: RETRYABLE_MESSAGES.invalid_checker_response,
        },
        internationalPassport: {
          kind: 'retryable',
          message: RETRYABLE_MESSAGES.upstream_response,
        },
      })
      unsubscribe()
    })

    expect(setSpy).not.toHaveBeenCalled()
    expect(await storage.get(PASSPORT_LAST_RESULT_KEY)).toEqual(V2_STORED)
  })

  it('clears a document error after that document succeeds on a later aggregate', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(TWO_ERRORS).mockResolvedValueOnce(ID_SUCCESS_PASSPORT_ERROR)
    const storage = createFakeStorage()

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date('2026-07-24T13:07:00'),
      })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())

      await run()
      expect(read()).toMatchObject({
        kind: 'results',
        idCard: { kind: 'retryable' },
        internationalPassport: { kind: 'retryable' },
      })

      await run()
      expect(read()).toEqual({
        kind: 'results',
        idCard: {
          kind: 'success',
          status: 202,
          message: 'Новый ID результат',
          checkedAtLabel: '13:07',
        },
        internationalPassport: {
          kind: 'retryable',
          message: RETRYABLE_MESSAGES.upstream_response,
        },
      })
    })
  })

  it('applies live storage updates to an unmasked sibling while preserving the current error', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(ID_ERROR_PASSPORT_SUCCESS)
    const storage = createFakeStorage()
    await seed(storage, V2_STORED)

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date('2026-07-24T21:40:00'),
      })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())
      const unsubscribe = model.viewState.subscribe(() => {})
      await vi.waitFor(() => expect(read().kind).toBe('results'))

      await run()
      await vi.waitFor(async () => {
        expect(await storage.get(PASSPORT_LAST_RESULT_KEY)).toMatchObject({
          internationalPassport: { status: 203 },
        })
      })

      await storage.set(PASSPORT_LAST_RESULT_KEY, {
        version: 2,
        idCard: {
          status: 299,
          message: 'ID из другого клиента',
          checkedAt: new Date('2026-07-24T20:00:00').getTime(),
        },
        internationalPassport: {
          status: 298,
          message: 'Загран из другого клиента',
          checkedAt: new Date('2026-07-24T20:01:00').getTime(),
        },
      })

      await vi.waitFor(() => {
        expect(read()).toEqual({
          kind: 'results',
          idCard: {
            kind: 'retryable',
            message: RETRYABLE_MESSAGES.invalid_checker_response,
          },
          internationalPassport: {
            kind: 'success',
            status: 298,
            message: 'Загран из другого клиента',
            checkedAtLabel: '20:01',
          },
        })
      })
      unsubscribe()
    })
  })

  it('keeps the optimistic aggregate visible when the storage write fails', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(TWO_SUCCESSES)
    const storage = createFakeStorage()
    vi.spyOn(storage, 'set').mockResolvedValue(new StorageError({ reason: 'offline' }))

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date('2026-07-24T13:07:00'),
      })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())
      const unsubscribe = model.viewState.subscribe(() => {})

      await run()

      expect(read()).toEqual({
        kind: 'results',
        idCard: {
          kind: 'success',
          status: 200,
          message: 'ID готова',
          checkedAtLabel: '13:07',
        },
        internationalPassport: {
          kind: 'success',
          status: 201,
          message: 'Загран готов',
          checkedAtLabel: '13:07',
        },
      })
      unsubscribe()
    })

    expect(await storage.get(PASSPORT_LAST_RESULT_KEY)).toBeNull()
  })

  it('stays idle without an RPC when the storage subscription reports a read failure', async () => {
    const { api, invoke } = makeApi()
    let subscribed = false
    const subscribe: StorageApi['subscribe'] = (_key, listener) => {
      subscribed = true
      listener(new StorageError({ reason: 'read failed' }))
      return () => {}
    }
    const storage: StorageApi = { ...createFakeStorage(), subscribe }

    await context.start(async () => {
      const model = makePassportCheckModel({ api, storage })
      const read = wrap(() => model.viewState())
      const unsubscribe = model.viewState.subscribe(() => {})

      expect(read()).toEqual({ kind: 'idle' })
      unsubscribe()
    })

    expect(subscribed).toBe(true)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('shows a global failed check without erasing either stored document', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(apiError('browser_unavailable'))
    const storage = createFakeStorage()
    await seed(storage, V2_STORED)

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

    expect(await storage.get(PASSPORT_LAST_RESULT_KEY)).toEqual(V2_STORED)
  })
})
