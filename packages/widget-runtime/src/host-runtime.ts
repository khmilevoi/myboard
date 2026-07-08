import { HttpClient, type HttpLike } from '@shared/http/client'
import { makeEventSourceStream, type OpenEventStream } from '@shared/http/event-stream'
import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'

import type { ScopedStorage, WidgetStorage } from './storage'
import { makeDexieStorage } from './storage/client/dexie-storage'
import { instanceNamespace, typeNamespace } from './storage/scope'
import { makeHttpStorage } from './storage/server/http-storage'
import { makeSseManager, type SseDeliver, type SseManager } from './storage/server/sse-client'
import { makeWidgetApi as makeWidgetApiWith, type WidgetApiError } from './widget-api'

export type HostRuntimeOptions = {
  serverBaseUrl?: string // default '/api/storage'
  http?: HttpLike // the host's shared client (the board passes its retry-hooked one); default: bare new HttpClient()
  openEventStream?: OpenEventStream // test seam for the lazily built SSE manager; default: makeEventSourceStream()
}

export type HostRuntime = {
  makeWidgetStorage(options: { instanceId: string; typeId: string }): WidgetStorage
  makeScopedStorage(scope: string): ScopedStorage
  makeWidgetApi<Events extends WidgetEventMap>(options: {
    instanceId: string
    typeId: string
  }): WidgetApi<Events, WidgetApiError>
}

/**
 * The widget-runtime composition root: one per document, owning the SSE
 * manager and running every request through ONE HttpClient — the board
 * injects its shared retry-hooked client, bare hosts (harnesses) get an
 * internally built bare one. Auth never exists below a composition root:
 * there is no onUnauthorized option — 401 healing is entirely the injected
 * client's concern. Hosts build exactly one runtime; two runtimes would
 * open two SSE connections — tests only.
 */
export function makeHostRuntime(options: HostRuntimeOptions = {}): HostRuntime {
  const baseUrl = options.serverBaseUrl ?? '/api/storage'
  const http = options.http ?? new HttpClient()
  // Lazy: building a runtime must not open an SSE connection until the first
  // subscription — harness pages and unit tests never connect.
  let sse: SseManager | undefined
  const getSse = () =>
    (sse ??= makeSseManager({
      baseUrl,
      http,
      openEventStream: options.openEventStream ?? makeEventSourceStream(),
    }))
  const registerKey = (fullKey: string, deliver: SseDeliver) => getSse().add(fullKey, deliver)

  const makeScoped = (scope: string): ScopedStorage => {
    const scopeWithColon = scope.endsWith(':') ? scope : `${scope}:`
    return {
      client: makeDexieStorage(scopeWithColon),
      server: makeHttpStorage(scopeWithColon, { baseUrl, http, registerKey }),
    }
  }

  return {
    makeScopedStorage: makeScoped,
    makeWidgetStorage: ({ instanceId, typeId }) => ({
      instance: makeScoped(instanceNamespace(instanceId)),
      shared: makeScoped(typeNamespace(typeId)),
    }),
    makeWidgetApi: ({ instanceId, typeId }) => makeWidgetApiWith({ instanceId, typeId, http }),
  }
}
