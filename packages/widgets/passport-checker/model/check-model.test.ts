import { context, wrap } from '@reatom/core'
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import type { WidgetApi } from '@shared/widgets/contracts'
import { makeHostRuntime, StorageError, WidgetApiError } from 'widget-runtime'
import type { StorageApi, StorageListener } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import type { PassportCheckerEvents, PassportCheckResult } from '../types'
import {
  CHECK_DEADLINE_MS,
  GENERIC_RETRYABLE_MESSAGE,
  formatCheckedAt,
  legacyStoredResultSchema,
  mapCheckResult,
  makePassportCheckModel,
  mapCheckError,
  PASSPORT_ID_CARD_LAST_RESULT_V2_KEY,
  PASSPORT_INTERNATIONAL_PASSPORT_LAST_RESULT_V2_KEY,
  PASSPORT_LEGACY_LAST_RESULT_KEY,
  RETRYABLE_MESSAGES,
  storedDocumentResultSchema,
  type StoredDocumentResult,
} from './check-model'

type CheckResult = PassportCheckResult
type StoredCheckResultV2 = {
  version: 2
  idCard?: StoredDocumentResult
  internationalPassport?: StoredDocumentResult
}

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

const COMPLETE_RETRY_SUCCESSES: PassportCheckResult = {
  idCard: { kind: 'success', status: 204, send_status_msg: 'ID complete' },
  internationalPassport: {
    kind: 'success',
    status: 205,
    send_status_msg: 'Passport complete',
  },
}

const TWO_ERRORS: PassportCheckResult = {
  idCard: { kind: 'error', code: 'invalid_checker_response' },
  internationalPassport: { kind: 'error', code: 'upstream_response' },
}

function makeApi() {
  const invoke = vi.fn<(event: string, payload: Record<string, never>) => Promise<unknown>>()
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
  it.each([
    ['unknown_event', 404],
    ['unknown_task', 502],
  ])(
    'falls back through the legacy check on unsupported checkV2 code %s and finishes with an honest partial v2 result',
    async (unsupportedCode, status) => {
      const { http, calls } = makeScriptedHttp({
        '/api/widgets/passport-checker/checkV2': [
          {
            status,
            body: { error: { code: unsupportedCode, message: 'Unsupported v2 boundary' } },
          },
        ],
        '/api/widgets/passport-checker/check': [
          {
            status: 200,
            body: { data: { status: 206, send_status_msg: 'Legacy ID ready' } },
          },
        ],
      })
      const api = makeHostRuntime({ http }).makeWidgetApi<PassportCheckerEvents>({
        typeId: 'passport-checker',
        instanceId: 'placement-1',
      })
      const storage = createFakeStorage()

      await context.start(async () => {
        const model = makePassportCheckModel({
          api,
          storage,
          now: () => new Date('2026-07-24T13:07:00'),
        })
        const read = wrap(() => model.viewState())
        const run = wrap(() => model.checkPassport())
        const unsubscribe = model.viewState.subscribe(() => {})

        await expect(run()).resolves.toBeUndefined()

        expect(calls.map(({ url }) => url)).toEqual([
          '/api/widgets/passport-checker/checkV2',
          '/api/widgets/passport-checker/check',
        ])
        expect(read()).toEqual({
          kind: 'results',
          idCard: {
            kind: 'success',
            status: 206,
            message: 'Legacy ID ready',
            checkedAtLabel: '13:07',
          },
          internationalPassport: { kind: 'unchecked' },
        })
        unsubscribe()
      })

      await vi.waitFor(async () => {
        expect(await readV2(storage)).toEqual({
          version: 2,
          idCard: {
            status: 206,
            message: 'Legacy ID ready',
            checkedAt: new Date('2026-07-24T13:07:00').getTime(),
          },
        })
      })
      expect(await storage.get(PASSPORT_LEGACY_LAST_RESULT_KEY)).toBeNull()
    },
  )

  it('turns a malformed checkV2 response into retryable state instead of throwing or staying pending', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/widgets/passport-checker/checkV2': [
        {
          status: 200,
          body: {
            data: {
              idCard: null,
              internationalPassport: { kind: 'success', status: 'wrong', send_status_msg: 42 },
            },
          },
        },
      ],
    })
    const api = makeHostRuntime({ http }).makeWidgetApi<PassportCheckerEvents>({
      typeId: 'passport-checker',
      instanceId: 'placement-1',
    })

    await context.start(async () => {
      const model = makePassportCheckModel({ api, storage: createFakeStorage() })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())

      await expect(run()).resolves.toBeUndefined()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        method: 'POST',
        url: '/api/widgets/passport-checker/checkV2',
      })
      expect(read()).toEqual({ kind: 'retryable', message: GENERIC_RETRYABLE_MESSAGE })
    })
  })

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

  it('lands a late success: an invoke that resolves after the deadline still persists document results and clears the transient error', async () => {
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

async function seed(storage: StorageApi, value: unknown, key: string) {
  const result = await storage.set(key, value)
  if (result instanceof Error) throw result
}

async function seedV2(storage: StorageApi, value: StoredCheckResultV2) {
  if (value.idCard) {
    await seed(storage, value.idCard, PASSPORT_ID_CARD_LAST_RESULT_V2_KEY)
  }
  if (value.internationalPassport) {
    await seed(
      storage,
      value.internationalPassport,
      PASSPORT_INTERNATIONAL_PASSPORT_LAST_RESULT_V2_KEY,
    )
  }
}

async function readV2(storage: StorageApi): Promise<StoredCheckResultV2 | null> {
  const [idCard, internationalPassport] = await Promise.all([
    storage.get(PASSPORT_ID_CARD_LAST_RESULT_V2_KEY, storedDocumentResultSchema),
    storage.get(PASSPORT_INTERNATIONAL_PASSPORT_LAST_RESULT_V2_KEY, storedDocumentResultSchema),
  ])
  if (idCard instanceof Error) throw idCard
  if (internationalPassport instanceof Error) throw internationalPassport
  if (idCard === null && internationalPassport === null) return null
  return {
    version: 2,
    ...(idCard ? { idCard } : {}),
    ...(internationalPassport ? { internationalPassport } : {}),
  }
}

function delayStorageSubscription(base: StorageApi) {
  const listeners = new Map<string, Set<StorageListener>>()
  const subscribe: StorageApi['subscribe'] = (key, listener) => {
    const storageListener = listener as StorageListener
    const keyListeners = listeners.get(key) ?? new Set<StorageListener>()
    keyListeners.add(storageListener)
    listeners.set(key, keyListeners)
    return () => keyListeners.delete(storageListener)
  }

  return {
    storage: { ...base, subscribe } satisfies StorageApi,
    emitValue(key: string, value: unknown) {
      for (const listener of listeners.get(key) ?? []) listener({ value })
    },
    emitError(key: string, error: StorageError) {
      for (const listener of listeners.get(key) ?? []) listener(error)
    },
    hasSubscriber(key: string) {
      return (listeners.get(key)?.size ?? 0) > 0
    },
  }
}

function delayStorageFanout() {
  const base = createFakeStorage()
  const listeners = new Map<string, Set<StorageListener>>()
  const subscriptions: string[] = []
  const writes: { key: string; value: unknown }[] = []
  const writeWaiters: { count: number; resolve: () => void }[] = []

  const storage: StorageApi = {
    ...base,
    async set(key, value, options) {
      const result = await base.set(key, value, options)
      if (result instanceof Error) return result
      writes.push({ key, value })
      for (const waiter of writeWaiters.splice(0)) {
        if (writes.length >= waiter.count) waiter.resolve()
        else writeWaiters.push(waiter)
      }
    },
    subscribe<T>(key: string, listener: StorageListener<T>) {
      subscriptions.push(key)
      const storageListener = listener as StorageListener
      const unsubscribeInitial = base.subscribe(key, listener)
      unsubscribeInitial()
      const keyListeners = listeners.get(key) ?? new Set<StorageListener>()
      keyListeners.add(storageListener)
      listeners.set(key, keyListeners)
      return () => keyListeners.delete(storageListener)
    },
  }

  return {
    storage,
    subscriptions,
    writes,
    waitForWrites(count: number) {
      if (writes.length >= count) return Promise.resolve()
      return new Promise<void>((resolve) => writeWaiters.push({ count, resolve }))
    },
  }
}

describe('versioned storage schemas', () => {
  // Every other test in this file goes through createFakeStorage, which
  // explicitly skips schema validation (see its fakes), so on the real HTTP
  // backend this schema is a production-only path.
  it('validates one document value per V2 key and rejects an aggregate value', () => {
    expect(legacyStoredResultSchema.safeParse(LEGACY_STORED).success).toBe(true)
    expect(legacyStoredResultSchema.safeParse(V2_STORED).success).toBe(false)
    expect(storedDocumentResultSchema.safeParse(V2_STORED.idCard).success).toBe(true)
    expect(storedDocumentResultSchema.safeParse(V2_STORED.internationalPassport).success).toBe(true)
    expect(storedDocumentResultSchema.safeParse(V2_STORED).success).toBe(false)
  })
})

describe('mapCheckResult', () => {
  const observationTime = new Date('2026-07-24T13:07:00').getTime()

  it('maps two successes to independent document values at one observation time', () => {
    expect(mapCheckResult({ result: TWO_SUCCESSES, checkedAt: observationTime })).toEqual({
      successes: {
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

  it('maps only the successful ID card when the passport fails', () => {
    expect(
      mapCheckResult({
        result: ID_SUCCESS_PASSPORT_ERROR,
        checkedAt: observationTime,
      }),
    ).toEqual({
      successes: {
        idCard: { status: 202, message: 'Новый ID результат', checkedAt: observationTime },
      },
      errors: {
        internationalPassport: {
          kind: 'retryable',
          message: 'Сервис проверки временно недоступен',
        },
      },
    })
  })

  it('maps only the successful passport when the ID card fails', () => {
    expect(
      mapCheckResult({
        result: ID_ERROR_PASSPORT_SUCCESS,
        checkedAt: observationTime,
      }),
    ).toEqual({
      successes: {
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
    expect(mapCheckResult({ result: TWO_ERRORS, checkedAt: observationTime })).toEqual({
      successes: {},
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

describe('passport result storage keys', () => {
  // Every test in this file reaches storage through the constant, never the
  // literal, so a silent rename here would keep the suite green while
  // orphaning every deployed user's stored result under the old key (see
  // CLAUDE.md's storage-keys-are-a-persistence-contract warning).
  it('uses stable independent V2 document keys and the untouched legacy key', () => {
    expect(PASSPORT_LEGACY_LAST_RESULT_KEY).toBe('lastResult')
    expect(PASSPORT_ID_CARD_LAST_RESULT_V2_KEY).toBe('lastResultV2:idCard')
    expect(PASSPORT_INTERNATIONAL_PASSPORT_LAST_RESULT_V2_KEY).toBe(
      'lastResultV2:internationalPassport',
    )
  })
})

describe('makePassportCheckModel persistence', () => {
  it('preserves complementary partial successes from two clients before storage fanout', async () => {
    const clientA = makeApi()
    const clientB = makeApi()
    const hydrationClient = makeApi()
    clientA.invoke.mockResolvedValueOnce(ID_SUCCESS_PASSPORT_ERROR)
    clientB.invoke.mockResolvedValueOnce(ID_ERROR_PASSPORT_SUCCESS)
    const controlled = delayStorageFanout()
    const firstCheckedAt = new Date('2026-07-24T14:00:00').getTime()
    const secondCheckedAt = new Date('2026-07-24T15:00:00').getTime()

    await context.start(async () => {
      const modelA = makePassportCheckModel({
        api: clientA.api,
        storage: controlled.storage,
        now: () => new Date(firstCheckedAt),
      })
      const modelB = makePassportCheckModel({
        api: clientB.api,
        storage: controlled.storage,
        now: () => new Date(secondCheckedAt),
      })
      const hydratedModel = makePassportCheckModel({
        api: hydrationClient.api,
        storage: controlled.storage,
        now: () => new Date(secondCheckedAt),
      })
      const readA = wrap(() => modelA.viewState())
      const readB = wrap(() => modelB.viewState())
      const readHydrated = wrap(() => hydratedModel.viewState())
      const runA = wrap(() => modelA.checkPassport())
      const runB = wrap(() => modelB.checkPassport())
      const connectHydrated = wrap(() => {
        const unsubscribeIdCard = hydratedModel.idCardLastResult.subscribe(() => {})
        const unsubscribeInternationalPassport =
          hydratedModel.internationalPassportLastResult.subscribe(() => {})
        const unsubscribeLegacy = hydratedModel.legacyLastResult.subscribe(() => {})
        const unsubscribeView = hydratedModel.viewState.subscribe(() => {})
        return () => {
          unsubscribeView()
          unsubscribeLegacy()
          unsubscribeInternationalPassport()
          unsubscribeIdCard()
        }
      })
      const isHydratedA = wrap(
        () =>
          !modelA.idCardLastResult.isLoading() &&
          !modelA.internationalPassportLastResult.isLoading() &&
          !modelA.legacyLastResult.isLoading(),
      )
      const isHydratedB = wrap(
        () =>
          !modelB.idCardLastResult.isLoading() &&
          !modelB.internationalPassportLastResult.isLoading() &&
          !modelB.legacyLastResult.isLoading(),
      )
      const unsubscribeAIdCard = modelA.idCardLastResult.subscribe(() => {})
      const unsubscribeAInternationalPassport = modelA.internationalPassportLastResult.subscribe(
        () => {},
      )
      const unsubscribeALegacy = modelA.legacyLastResult.subscribe(() => {})
      const unsubscribeBIdCard = modelB.idCardLastResult.subscribe(() => {})
      const unsubscribeBInternationalPassport = modelB.internationalPassportLastResult.subscribe(
        () => {},
      )
      const unsubscribeBLegacy = modelB.legacyLastResult.subscribe(() => {})
      const unsubscribeA = modelA.viewState.subscribe(() => {})
      const unsubscribeB = modelB.viewState.subscribe(() => {})

      await vi.waitFor(() => {
        expect(controlled.subscriptions.length).toBeGreaterThanOrEqual(6)
        expect(readA()).toEqual({ kind: 'idle' })
        expect(readB()).toEqual({ kind: 'idle' })
        expect(isHydratedA()).toBe(true)
        expect(isHydratedB()).toBe(true)
      })

      await runA()
      await controlled.waitForWrites(1)
      await runB()
      await controlled.waitForWrites(2)

      const unsubscribeHydrated = connectHydrated()

      await vi.waitFor(() => {
        expect(readHydrated()).toEqual({
          kind: 'results',
          idCard: {
            kind: 'success',
            status: 202,
            message: 'Новый ID результат',
            checkedAtLabel: '14:00',
          },
          internationalPassport: {
            kind: 'success',
            status: 203,
            message: 'Новый загран результат',
            checkedAtLabel: '15:00',
          },
        })
      })
      expect(controlled.writes.map(({ key }) => key)).toEqual([
        PASSPORT_ID_CARD_LAST_RESULT_V2_KEY,
        PASSPORT_INTERNATIONAL_PASSPORT_LAST_RESULT_V2_KEY,
      ])
      expect(controlled.writes.map(({ key }) => key)).not.toContain('lastResultV2')

      unsubscribeHydrated()
      unsubscribeB()
      unsubscribeA()
      unsubscribeBLegacy()
      unsubscribeBInternationalPassport()
      unsubscribeBIdCard()
      unsubscribeALegacy()
      unsubscribeAInternationalPassport()
      unsubscribeAIdCard()
    })

    expect(hydrationClient.invoke).not.toHaveBeenCalled()
  })

  it('isolates V2 document writes from the legacy and removed aggregate keys', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(TWO_SUCCESSES)
    const storage = createFakeStorage()
    await storage.set(PASSPORT_LEGACY_LAST_RESULT_KEY, LEGACY_STORED)

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date('2026-07-24T13:07:00'),
      })
      const run = wrap(() => model.checkPassport())
      await run()
    })

    await vi.waitFor(async () => {
      expect(await readV2(storage)).toEqual({
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
    expect(await storage.get(PASSPORT_LEGACY_LAST_RESULT_KEY)).toEqual(LEGACY_STORED)
    expect(await storage.get('lastResultV2')).toBeNull()
  })

  it('keeps v2 authoritative when a stale old client overwrites lastResult', async () => {
    const { api, invoke } = makeApi()
    const storage = createFakeStorage()
    const staleLegacyWrite = {
      status: 503,
      message: 'Старый таб перезаписал ID',
      checkedAt: new Date('2026-07-24T14:30:00').getTime(),
    }
    await seedV2(storage, V2_STORED)
    await seed(storage, LEGACY_STORED, PASSPORT_LEGACY_LAST_RESULT_KEY)

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date('2026-07-24T21:40:00'),
      })
      const read = wrap(() => model.viewState())
      const unsubscribe = model.viewState.subscribe(() => {})
      const expected = {
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
      }

      await vi.waitFor(() => expect(read()).toEqual(expected))
      await storage.set(PASSPORT_LEGACY_LAST_RESULT_KEY, staleLegacyWrite)
      await vi.waitFor(() => expect(read()).toEqual(expected))
      unsubscribe()
    })

    expect(invoke).not.toHaveBeenCalled()
    expect(await readV2(storage)).toEqual(V2_STORED)
    expect(await storage.get(PASSPORT_LEGACY_LAST_RESULT_KEY)).toEqual(staleLegacyWrite)
  })

  it('writes two successful documents to independent shared keys', async () => {
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
      expect(await readV2(storage)).toEqual({
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
    await seed(storage, LEGACY_STORED, PASSPORT_LEGACY_LAST_RESULT_KEY)
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

  it('waits for the ID V2 snapshot before using legacy fallback and lets V2 take authority', async () => {
    const { api, invoke } = makeApi()
    const controlled = delayStorageSubscription(createFakeStorage())
    const staleLegacy = {
      status: 503,
      message: 'Старый таб обновил legacy',
      checkedAt: new Date('2026-07-24T14:30:00').getTime(),
    }

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage: controlled.storage,
        now: () => new Date('2026-07-24T21:40:00'),
      })
      const read = wrap(() => model.viewState())
      const isLegacyHydrated = wrap(() => !model.legacyLastResult.isLoading())
      const isIdCardHydrated = wrap(() => !model.idCardLastResult.isLoading())
      const hydrateLegacy = wrap(() =>
        controlled.emitValue(PASSPORT_LEGACY_LAST_RESULT_KEY, LEGACY_STORED),
      )
      const hydrateIdCard = wrap((value: typeof V2_STORED.idCard | null) =>
        controlled.emitValue(PASSPORT_ID_CARD_LAST_RESULT_V2_KEY, value),
      )
      const updateLegacy = wrap(() =>
        controlled.emitValue(PASSPORT_LEGACY_LAST_RESULT_KEY, staleLegacy),
      )
      const unsubscribe = model.viewState.subscribe(() => {})

      await vi.waitFor(() => {
        expect(controlled.hasSubscriber(PASSPORT_LEGACY_LAST_RESULT_KEY)).toBe(true)
        expect(controlled.hasSubscriber(PASSPORT_ID_CARD_LAST_RESULT_V2_KEY)).toBe(true)
      })
      hydrateLegacy()
      await vi.waitFor(() => expect(isLegacyHydrated()).toBe(true))
      expect(read()).toEqual({ kind: 'idle' })

      hydrateIdCard(null)
      await vi.waitFor(() => {
        expect(isIdCardHydrated()).toBe(true)
        expect(read()).toMatchObject({
          kind: 'results',
          idCard: { kind: 'success', status: 200, message: 'Старый ID результат' },
        })
      })

      hydrateIdCard(V2_STORED.idCard)
      updateLegacy()
      await vi.waitFor(() => {
        expect(read()).toMatchObject({
          kind: 'results',
          idCard: { kind: 'success', status: 200, message: 'ID сохранена' },
        })
      })
      unsubscribe()
    })

    expect(invoke).not.toHaveBeenCalled()
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
    await seedV2(storage, stored)

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

  it('persists a partial branch before delayed hydration and preserves the unknown sibling', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(ID_SUCCESS_PASSPORT_ERROR)
    const base = createFakeStorage()
    await seedV2(base, V2_STORED)
    const controlled = delayStorageSubscription(base)
    const observationTime = new Date('2026-07-24T13:07:00').getTime()

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage: controlled.storage,
        now: () => new Date(observationTime),
      })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())
      const hydrate = wrap(() => {
        controlled.emitValue(PASSPORT_ID_CARD_LAST_RESULT_V2_KEY, V2_STORED.idCard)
        controlled.emitValue(
          PASSPORT_INTERNATIONAL_PASSPORT_LAST_RESULT_V2_KEY,
          V2_STORED.internationalPassport,
        )
      })
      const unsubscribe = model.viewState.subscribe(() => {})

      await run()

      await vi.waitFor(async () => {
        expect(await readV2(base)).toEqual({
          version: 2,
          idCard: {
            status: 202,
            message: 'Новый ID результат',
            checkedAt: observationTime,
          },
          internationalPassport: V2_STORED.internationalPassport,
        })
      })
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

      hydrate()
      await vi.waitFor(async () => {
        expect(await readV2(base)).toEqual({
          version: 2,
          idCard: {
            status: 202,
            message: 'Новый ID результат',
            checkedAt: observationTime,
          },
          internationalPassport: V2_STORED.internationalPassport,
        })
      })
      unsubscribe()
    })
  })

  it('accumulates completed complementary partial successes across retries before hydration', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(ID_SUCCESS_PASSPORT_ERROR)
    invoke.mockResolvedValueOnce(ID_ERROR_PASSPORT_SUCCESS)
    const base = createFakeStorage()
    await seedV2(base, V2_STORED)
    const controlled = delayStorageSubscription(base)
    const firstCheckedAt = new Date('2026-07-24T14:00:00').getTime()
    const secondCheckedAt = new Date('2026-07-24T15:00:00').getTime()
    let currentTime = firstCheckedAt

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage: controlled.storage,
        now: () => new Date(currentTime),
      })
      const read = wrap(() => model.viewState())
      const readStored = wrap((): StoredCheckResultV2 | null => {
        const idCard = model.idCardLastResult()
        const internationalPassport = model.internationalPassportLastResult()
        if (idCard === null && internationalPassport === null) return null
        return {
          version: 2,
          ...(idCard ? { idCard } : {}),
          ...(internationalPassport ? { internationalPassport } : {}),
        }
      })
      const run = wrap(() => model.checkPassport())
      const hydrateInternationalPassport = wrap(() =>
        controlled.emitValue(
          PASSPORT_INTERNATIONAL_PASSPORT_LAST_RESULT_V2_KEY,
          V2_STORED.internationalPassport,
        ),
      )
      const hydrateIdCard = wrap(() =>
        controlled.emitValue(PASSPORT_ID_CARD_LAST_RESULT_V2_KEY, V2_STORED.idCard),
      )
      const unsubscribe = model.viewState.subscribe(() => {})

      // Both attempts complete before the first storage snapshot. They are not
      // late stragglers: the second retry starts only after the first result is
      // accepted, so its ID-card error must not discard the first ID success.
      await run()
      currentTime = secondCheckedAt
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
          checkedAtLabel: '15:00',
        },
      })

      hydrateInternationalPassport()
      hydrateIdCard()
      await vi.waitFor(async () => {
        const expectedStored = {
          version: 2 as const,
          idCard: {
            status: 202,
            message: 'Новый ID результат',
            checkedAt: firstCheckedAt,
          },
          internationalPassport: {
            status: 203,
            message: 'Новый загран результат',
            checkedAt: secondCheckedAt,
          },
        }

        expect(readStored()).toEqual(expectedStored)
        expect(await readV2(base)).toEqual(expectedStored)
      })
      unsubscribe()
    })
  })

  it('persists a partial success after its storage read error without overwriting the sibling', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(ID_SUCCESS_PASSPORT_ERROR)
    const base = createFakeStorage()
    await seedV2(base, V2_STORED)
    const controlled = delayStorageSubscription(base)
    const observationTime = new Date('2026-07-24T13:07:00').getTime()

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage: controlled.storage,
        now: () => new Date(observationTime),
      })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())
      const failRead = wrap(() =>
        controlled.emitError(
          PASSPORT_ID_CARD_LAST_RESULT_V2_KEY,
          new StorageError({ reason: 'read failed' }),
        ),
      )
      const unsubscribe = model.viewState.subscribe(() => {})

      failRead()
      await run()

      await vi.waitFor(async () => {
        expect(await readV2(base)).toEqual({
          version: 2,
          idCard: {
            status: 202,
            message: 'Новый ID результат',
            checkedAt: observationTime,
          },
          internationalPassport: V2_STORED.internationalPassport,
        })
      })
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
  })

  it('persists a complete retry after branch read errors and an earlier partial success', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(ID_SUCCESS_PASSPORT_ERROR)
    invoke.mockResolvedValueOnce(COMPLETE_RETRY_SUCCESSES)
    const base = createFakeStorage()
    await seedV2(base, V2_STORED)
    const set = vi.spyOn(base, 'set')
    set.mockClear()
    const controlled = delayStorageSubscription(base)
    const firstCheckedAt = new Date('2026-07-24T14:00:00').getTime()
    const completeCheckedAt = new Date('2026-07-24T15:00:00').getTime()
    let currentTime = firstCheckedAt

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage: controlled.storage,
        now: () => new Date(currentTime),
      })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())
      const failReads = wrap(() => {
        controlled.emitError(
          PASSPORT_ID_CARD_LAST_RESULT_V2_KEY,
          new StorageError({ reason: 'read failed' }),
        )
        controlled.emitError(
          PASSPORT_INTERNATIONAL_PASSPORT_LAST_RESULT_V2_KEY,
          new StorageError({ reason: 'read failed' }),
        )
      })
      const unsubscribe = model.viewState.subscribe(() => {})

      failReads()
      await run()
      currentTime = completeCheckedAt
      await run()

      const expected = {
        version: 2 as const,
        idCard: { status: 204, message: 'ID complete', checkedAt: completeCheckedAt },
        internationalPassport: {
          status: 205,
          message: 'Passport complete',
          checkedAt: completeCheckedAt,
        },
      }

      expect(read()).toEqual({
        kind: 'results',
        idCard: {
          kind: 'success',
          status: 204,
          message: 'ID complete',
          checkedAtLabel: '15:00',
        },
        internationalPassport: {
          kind: 'success',
          status: 205,
          message: 'Passport complete',
          checkedAtLabel: '15:00',
        },
      })
      await vi.waitFor(async () => {
        expect(set).toHaveBeenCalledWith(PASSPORT_ID_CARD_LAST_RESULT_V2_KEY, expected.idCard)
        expect(set).toHaveBeenCalledWith(
          PASSPORT_INTERNATIONAL_PASSPORT_LAST_RESULT_V2_KEY,
          expected.internationalPassport,
        )
        expect(set).not.toHaveBeenCalledWith('lastResultV2', expect.anything())
        expect(await readV2(base)).toEqual(expected)
      })
      unsubscribe()
    })
  })

  it('merges an ID success, preserves and masks the failed stored international passport', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(ID_SUCCESS_PASSPORT_ERROR)
    const storage = createFakeStorage()
    await seedV2(storage, V2_STORED)
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
      expect(await readV2(storage)).toEqual({
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
    await seedV2(storage, V2_STORED)
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
      expect(await readV2(storage)).toEqual({
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
    await seedV2(storage, V2_STORED)
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
    expect(await readV2(storage)).toEqual(V2_STORED)
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
    await seedV2(storage, V2_STORED)

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
        expect(await storage.get(PASSPORT_INTERNATIONAL_PASSPORT_LAST_RESULT_V2_KEY)).toMatchObject(
          { status: 203 },
        )
      })

      await storage.set(PASSPORT_INTERNATIONAL_PASSPORT_LAST_RESULT_V2_KEY, {
        status: 298,
        message: 'Загран из другого клиента',
        checkedAt: new Date('2026-07-24T20:01:00').getTime(),
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

      await storage.set(PASSPORT_ID_CARD_LAST_RESULT_V2_KEY, {
        status: 299,
        message: 'ID из другого клиента',
        checkedAt: new Date('2026-07-24T20:00:00').getTime(),
      })
      expect(read()).toMatchObject({
        idCard: {
          kind: 'retryable',
          message: RETRYABLE_MESSAGES.invalid_checker_response,
        },
        internationalPassport: { kind: 'success', status: 298 },
      })
      unsubscribe()
    })
  })

  it('keeps both optimistic document results visible when their storage writes fail', async () => {
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

    expect(await readV2(storage)).toBeNull()
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
    await seedV2(storage, V2_STORED)

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

    expect(await readV2(storage)).toEqual(V2_STORED)
  })
})
