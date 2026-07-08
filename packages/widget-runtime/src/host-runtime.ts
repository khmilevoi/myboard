import { HttpClient, type HttpLike } from '@shared/http/client'
import type { OpenEventStream } from '@shared/http/event-stream'
import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'

import type { ScopedStorage, WidgetStorage } from './storage'
import { makeDexieStorage } from './storage/client/dexie-storage'
import { instanceNamespace, typeNamespace } from './storage/scope'
import { makeHttpStorage } from './storage/server/http-storage'
import { getSseManager, type SseDeliver } from './storage/server/sse-client'
import { makeWidgetApi as makeWidgetApiWith, type WidgetApiError } from './widget-api'

export type HostRuntimeOptions = {
  serverBaseUrl?: string // default '/api/storage'
  http?: HttpLike // the host's shared client (the board passes its retry-hooked one); default: bare new HttpClient()
  openEventStream?: OpenEventStream // test seam; wired to the SSE manager in Task 7
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
  // Task 7 replaces this with a lazily constructed makeSseManager({ baseUrl,
  // http, openEventStream }); until then the legacy module-level manager
  // keeps serving subscriptions unchanged.
  const registerKey = (fullKey: string, deliver: SseDeliver) =>
    getSseManager(baseUrl).add(fullKey, deliver)

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

/* --------------------------------------------------------------------------
 * Transitional free factories — DELETED in Task 9. A lazy module default
 * runtime keeps WidgetFrame / rootStorage / harnesses / widget tests
 * compiling until the composition roots land. No auth behavior: identical to
 * the pre-plan state.
 * ------------------------------------------------------------------------ */
let defaultRuntime: HostRuntime | undefined
function getDefaultRuntime(): HostRuntime {
  return (defaultRuntime ??= makeHostRuntime())
}

/** @deprecated transitional — build a HostRuntime at your composition root. */
export function makeWidgetStorage(options: { instanceId: string; typeId: string }): WidgetStorage {
  return getDefaultRuntime().makeWidgetStorage(options)
}

/** @deprecated transitional — build a HostRuntime at your composition root. */
export function makeScopedStorage(scope: string): ScopedStorage {
  return getDefaultRuntime().makeScopedStorage(scope)
}

/** @deprecated transitional — build a HostRuntime at your composition root. */
export function makeWidgetApi<Events extends WidgetEventMap>(options: {
  instanceId: string
  typeId: string
}): WidgetApi<Events, WidgetApiError> {
  return getDefaultRuntime().makeWidgetApi<Events>(options)
}
