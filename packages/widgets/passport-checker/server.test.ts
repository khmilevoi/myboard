// @vitest-environment node
import {
  BrowserAutomationDeadlineError,
  BrowserAutomationProtocolError,
  BrowserAutomationUnavailableError,
  BrowserTaskRejectedError,
} from '@shared/widgets/browser-errors'
import type { WidgetServerContext } from '@shared/widgets/contracts'
import { PublicWidgetError } from '@shared/widgets/public-error'

import { makePassportCheckerServer, mapRejectedTask } from './server'

function rejected(code: string, meta?: Record<string, unknown>) {
  return new BrowserTaskRejectedError({
    widgetId: 'passport-checker',
    taskId: 'check',
    code,
    publicMessage: `public message for ${code}`,
    meta,
  })
}

function makeContext(invokeResult: unknown) {
  const calls: Array<{ taskId: string; payload: unknown }> = []
  const context = {
    typeId: 'passport-checker',
    instanceId: 'placement-1',
    ip: null,
    now: () => 0,
    api: {
      browser: {
        invoke: async (task: { id: string }, payload: unknown) => {
          calls.push({ taskId: task.id, payload })
          return invokeResult
        },
      },
    },
  } as unknown as WidgetServerContext
  return { context, calls }
}

async function runCheck(invokeResult: unknown) {
  const definition = makePassportCheckerServer()
  const { context, calls } = makeContext(invokeResult)
  const result = await definition.handlers.check({}, context)
  return { result, calls }
}

async function runEvent(event: string, invokeResult: unknown) {
  const definition = makePassportCheckerServer()
  const { context, calls } = makeContext(invokeResult)
  const handler = Reflect.get(definition.handlers, event) as
    | ((payload: unknown, context: WidgetServerContext) => Promise<unknown> | unknown)
    | undefined
  expect(handler, `${event} handler`).toBeTypeOf('function')
  if (!handler) throw new Error(`missing ${event} handler`)
  const result = await handler({}, context)
  const schema = Reflect.get(definition.schemas, event) as
    | { result: { safeParse(value: unknown): { success: boolean; data?: unknown } } }
    | undefined
  return { result, calls, schema }
}

describe('passport checker server', () => {
  it('keeps the legacy check round trip and old-client storage shape intact', async () => {
    const { result, calls, schema } = await runEvent('check', {
      status: 200,
      send_status_msg: 'ID ready',
    })
    const parsed = schema?.result.safeParse(result)

    expect(parsed).toMatchObject({
      success: true,
      data: { status: 200, send_status_msg: 'ID ready' },
    })
    expect(result).toEqual({ status: 200, send_status_msg: 'ID ready' })
    expect({
      status: (result as { status: number }).status,
      message: (result as { send_status_msg: string }).send_status_msg,
      checkedAt: 123,
    }).toEqual({ status: 200, message: 'ID ready', checkedAt: 123 })
    expect(calls).toEqual([{ taskId: 'check', payload: {} }])
  })

  it('passes a validated aggregate through checkV2 and sends one empty browser payload', async () => {
    const aggregate = {
      idCard: { kind: 'success' as const, status: 200, send_status_msg: 'ID ready' },
      internationalPassport: {
        kind: 'error' as const,
        code: 'upstream_response' as const,
      },
    }
    const { result, calls, schema } = await runEvent('checkV2', aggregate)

    expect(result).toEqual(aggregate)
    expect(schema?.result.safeParse(result)).toMatchObject({ success: true, data: aggregate })
    expect(calls).toEqual([{ taskId: 'checkV2', payload: {} }])
  })

  it.each([
    [
      rejected('browser_session_required', { sshTarget: 'admin@pi' }),
      409,
      'browser_session_required',
      { sshTarget: 'admin@pi', novncPort: 6080 },
    ],
    [rejected('browser_session_required'), 409, 'browser_session_required', { novncPort: 6080 }],
    [rejected('browser_configuration'), 500, 'browser_configuration', undefined],
    [rejected('unknown_task'), 502, 'unknown_task', undefined],
    [
      rejected('upstream_response', { phase: 'submission', status: 502 }),
      502,
      'upstream_response',
      undefined,
    ],
    [rejected('invalid_checker_response'), 502, 'invalid_checker_response', undefined],
    [rejected('some_future_code'), 502, 'some_future_code', undefined],
    [
      new BrowserAutomationUnavailableError({ operation: 'invoke' }),
      503,
      'browser_unavailable',
      undefined,
    ],
    [new BrowserAutomationDeadlineError({ timeoutMs: 1000 }), 504, 'automation_timeout', undefined],
    [
      new BrowserAutomationProtocolError({
        phase: 'result',
        widgetId: 'passport-checker',
        taskId: 'check',
      }),
      502,
      'automation_protocol',
      undefined,
    ],
  ])('maps %s to a public widget error', async (gatewayError, status, code, meta) => {
    const { result } = await runCheck(gatewayError)

    expect(result).toBeInstanceOf(PublicWidgetError)
    if (!(result instanceof PublicWidgetError)) throw new Error('expected PublicWidgetError')
    expect(result.status).toBe(status)
    expect(result.code).toBe(code)
    expect(result.meta).toEqual(meta)
  })

  it('filters meta down to sshTarget and novncPort only', () => {
    const mapped = mapRejectedTask(
      rejected('browser_session_required', { sshTarget: 'admin@pi', secret: 'never' }),
    )

    expect(mapped.meta).toEqual({ sshTarget: 'admin@pi', novncPort: 6080 })
  })

  it('drops a non-string sshTarget', () => {
    const mapped = mapRejectedTask(rejected('browser_session_required', { sshTarget: 42 }))

    expect(mapped.meta).toEqual({ novncPort: 6080 })
  })

  it('passes through a valid novncPort from the upstream meta', () => {
    const mapped = mapRejectedTask(
      rejected('browser_session_required', { sshTarget: 'admin@pi', novncPort: 16080 }),
    )

    expect(mapped.meta).toEqual({ sshTarget: 'admin@pi', novncPort: 16080 })
  })

  it.each([0, -1, 1.5, '6080', null])(
    'falls back to the default port for an invalid novncPort meta value %s',
    (novncPort) => {
      const mapped = mapRejectedTask(
        rejected('browser_session_required', { sshTarget: 'admin@pi', novncPort }),
      )

      expect(mapped.meta).toEqual({ sshTarget: 'admin@pi', novncPort: 6080 })
    },
  )

  it('keeps the rejected error public message', () => {
    const mapped = mapRejectedTask(rejected('upstream_response'))

    expect(mapped.publicMessage).toBe('public message for upstream_response')
  })
})
