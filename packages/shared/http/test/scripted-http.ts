import {
  HttpTransportError,
  type HttpLike,
  type HttpRequestOptions,
  type HttpResponse,
} from '../client'

export type ScriptedStep = { status: number; body?: unknown } | 'network-error'
export type ScriptedCall = { method: string; url: string; json?: unknown }

/**
 * Test-only scripted HttpLike: each URL maps to a queue of steps consumed one
 * per call. Import from tests only, never from production code.
 */
export function makeScriptedHttp(script: Record<string, ScriptedStep[]>) {
  const calls: ScriptedCall[] = []
  const run = async (
    method: string,
    url: string,
    options?: HttpRequestOptions,
  ): Promise<HttpTransportError | HttpResponse> => {
    calls.push({ method, url, json: options?.json })
    const step = script[url]?.shift()
    if (!step) throw new Error(`unexpected ${method} ${url}`)
    if (step === 'network-error') {
      return new HttpTransportError({ reason: 'scripted network failure' })
    }
    return { status: step.status, ok: step.status >= 200 && step.status < 300, body: step.body }
  }
  const http: HttpLike = {
    get: (url, options) => run('GET', url, options),
    post: (url, options) => run('POST', url, options),
    put: (url, options) => run('PUT', url, options),
    delete: (url, options) => run('DELETE', url, options),
    patch: (url, options) => run('PATCH', url, options),
  }
  return { http, calls }
}
