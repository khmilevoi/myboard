import * as errore from 'errore'
import ky from 'ky'

import { CSRF_HEADER, CSRF_HEADER_VALUE } from './csrf'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export type HttpResponse = { status: number; ok: boolean; body: unknown }

export class HttpTransportError extends errore.createTaggedError({
  name: 'HttpTransportError',
  message: 'HTTP transport failed: $reason',
}) {}

export type HttpRequestContext = { method: HttpMethod; url: string; headers: Headers }
export type RequestHook = (ctx: HttpRequestContext) => void | Promise<void>
export type ResponseHookContext = { response: HttpResponse; retryCount: number }
export type ResponseHook = (ctx: ResponseHookContext) => void | 'retry' | Promise<void | 'retry'>

export type HttpRequestOptions = {
  json?: unknown
  searchParams?: Record<string, string>
}

export type HttpClientOptions = {
  baseUrl?: string
  onRequest?: RequestHook[]
  onResponse?: ResponseHook[]
  /** The ONE legitimate `typeof fetch` seam in the app: the adapter boundary. */
  fetch?: typeof globalThis.fetch
}

/** Structural view of HttpClient for consumers and test fakes. */
export type HttpLike = Pick<HttpClient, 'get' | 'post' | 'put' | 'delete' | 'patch'>

const MUTATING_METHODS = new Set<HttpMethod>(['POST', 'PUT', 'DELETE', 'PATCH'])

/**
 * The app's HTTP port: errore values out (HttpTransportError | HttpResponse),
 * non-2xx statuses are values, hooks are fixed at construction. ky runs inside
 * as a swappable adapter detail — throwHttpErrors off, no auto-retries, no
 * default timeout, so the port's semantics stay ours.
 */
export class HttpClient {
  readonly #options: HttpClientOptions

  constructor(options: HttpClientOptions = {}) {
    this.#options = options
  }

  get(url: string, options?: HttpRequestOptions) {
    return this.#send('GET', url, options, 0)
  }
  post(url: string, options?: HttpRequestOptions) {
    return this.#send('POST', url, options, 0)
  }
  put(url: string, options?: HttpRequestOptions) {
    return this.#send('PUT', url, options, 0)
  }
  delete(url: string, options?: HttpRequestOptions) {
    return this.#send('DELETE', url, options, 0)
  }
  patch(url: string, options?: HttpRequestOptions) {
    return this.#send('PATCH', url, options, 0)
  }

  async #send(
    method: HttpMethod,
    url: string,
    options: HttpRequestOptions | undefined,
    retryCount: number,
  ): Promise<HttpTransportError | HttpResponse> {
    const headers = new Headers()
    if (MUTATING_METHODS.has(method)) headers.set(CSRF_HEADER, CSRF_HEADER_VALUE)
    const ctx: HttpRequestContext = { method, url: this.#resolve(url), headers }
    for (const hook of this.#options.onRequest ?? []) await hook(ctx)

    const raw = await ky(ctx.url, {
      method,
      headers,
      credentials: 'same-origin',
      throwHttpErrors: false, // non-2xx is a value in this port
      retry: 0,
      timeout: false,
      ...(options?.json !== undefined ? { json: options.json } : {}),
      ...(options?.searchParams ? { searchParams: options.searchParams } : {}),
      // ky cancels the exact Request object it built once the response
      // settles (internal stream cleanup) — cloning before handing it to the
      // injected fetch keeps the clone readable afterward (e.g. test doubles
      // that inspect the sent request body), independent of that cleanup.
      ...(this.#options.fetch
        ? {
            fetch: (request: Request, init: RequestInit) =>
              this.#options.fetch!(request.clone(), init),
          }
        : {}),
    }).catch((cause) => new HttpTransportError({ reason: 'network request failed', cause }))
    if (raw instanceof Error) return raw

    const parsed = await parseBody(raw)
    if (parsed instanceof HttpTransportError) return parsed
    const response: HttpResponse = { status: raw.status, ok: raw.ok, body: parsed.body }

    for (const hook of this.#options.onResponse ?? []) {
      const verdict = await hook({ response, retryCount })
      // 'retry' short-circuits: the remaining hooks are skipped for this
      // response and every hook runs again on the replayed one. json bodies
      // are plain values re-serialized per attempt — no body-stream cloning
      // problem, POST included.
      if (verdict === 'retry' && retryCount === 0) return this.#send(method, url, options, 1)
    }
    return response
  }

  #resolve(url: string): string {
    const base = this.#options.baseUrl
    // Absolute URLs bypass baseUrl joining — `${base}/http://…` is never right.
    if (!base || /^https?:\/\//i.test(url)) return url
    return `${base.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`
  }
}

/**
 * Body semantics: empty body → undefined; broken JSON on a 2xx → transport
 * error; broken/empty body on a non-2xx → undefined (nginx error pages carry
 * no JSON — the status is the signal). The `{ body }` wrapper keeps the
 * union discriminable — `HttpTransportError | unknown` would collapse to
 * `unknown` and lose the error branch for the type checker.
 */
async function parseBody(raw: Response): Promise<HttpTransportError | { body: unknown }> {
  const text = await raw.text().catch(() => '')
  if (text === '') return { body: undefined }
  const parsed = errore.try(() => JSON.parse(text) as unknown)
  if (parsed instanceof Error) {
    return raw.ok
      ? new HttpTransportError({ reason: 'invalid JSON in a 2xx response', cause: parsed })
      : { body: undefined }
  }
  return { body: parsed }
}

/** 401 → ask the host to recover the session → replay the request once. */
export function makeUnauthorizedRetryHook(
  onUnauthorized: () => Promise<boolean>,
): ResponseHook {
  return async ({ response, retryCount }) => {
    if (response.status !== 401 || retryCount > 0) return
    const recovered = await onUnauthorized().catch(() => false)
    if (recovered) return 'retry'
  }
}
