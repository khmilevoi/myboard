import { HttpClient, type HttpLike } from '@shared/http/client'
import { makeEventSourceStream, type OpenEventStream } from '@shared/http/event-stream'
import type { ModuleScope } from '@shared/modules/contracts'
import type { ScopedBranch, ScopedStorageRef } from '@shared/storage/scoped'
import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'

import { makeWidgetIdentity, type WidgetIdentity } from './identity'
import { makeModuleApi } from './modules/module-api'
import { makeModuleRegistry, type WidgetModules } from './modules/registry'
import type { ScopedStorage, WidgetStorage } from './storage'
import {
  localNamespaceFor,
  makeAccountGatedStorage,
  makeIdentityAccountGate,
} from './storage/account-gate'
import { makeDexieStorage } from './storage/client/dexie-storage'
import { instanceNamespace, typeNamespace } from './storage/scope'
import { makeHttpStorage } from './storage/server/http-storage'
import { makeScopedHttpStorage } from './storage/server/scoped-http-storage'
import { makeSseManager, type SseDeliver, type SseManager } from './storage/server/sse-client'
import { getServerTime } from './timer/server-time'
import { makeWidgetApi as makeWidgetApiWith, type WidgetApiError } from './widget-api'

export type HostRuntimeOptions = {
  serverBaseUrl?: string // default '/api/storage'
  http?: HttpLike // the host's shared client (the board passes its retry-hooked one); default: bare new HttpClient()
  openEventStream?: OpenEventStream // test seam for the lazily built SSE manager; default: makeEventSourceStream()
  identity?: WidgetIdentity // test seam; default: makeWidgetIdentity({ http })
}

export type HostRuntime = {
  identity: WidgetIdentity
  makeWidgetStorage(options: { instanceId: string; typeId: string }): WidgetStorage
  makeScopedStorage(scope: string): ScopedStorage
  /** Scoped-route storage for one branch; account branches are gated on the viewer's account. */
  makeBranchStorage(branch: ScopedBranch): ScopedStorage
  /** The widget's view of the runtime's module registry, limited to the modules it declared. */
  makeWidgetModules(declared: readonly string[]): WidgetModules
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
  const registerScoped = (ref: ScopedStorageRef, deliver: SseDeliver) =>
    getSse().addScoped(ref, deliver)

  const makeScoped = (scope: string): ScopedStorage => {
    // The trailing colon is part of the persistence contract — read the header comment in
    // packages/shared/storage/scope.ts before touching this normalization.
    const scopeWithColon = scope.endsWith(':') ? scope : `${scope}:`
    return {
      client: makeDexieStorage(scopeWithColon),
      server: makeHttpStorage(scopeWithColon, { baseUrl, http, registerKey }),
    }
  }

  // Cheap to construct — the request itself is deferred to the first subscriber.
  const identity = options.identity ?? makeWidgetIdentity({ http })
  // Lazy too: the gate first subscribes to identity.viewer on its first use, never here.
  const accountGate = makeIdentityAccountGate(identity)

  const makeBranchStorage = (branch: ScopedBranch): ScopedStorage => {
    const server = makeScopedHttpStorage(branch, { baseUrl, http, registerScoped })
    if (branch.scope !== 'account') {
      return { client: makeDexieStorage(localNamespaceFor(branch, null)), server }
    }
    // The server branch resolves the account from the session itself; gating it too keeps both
    // halves of an account branch failing and waiting the same way while no account is known.
    return {
      client: makeAccountGatedStorage(accountGate, (accountId) =>
        makeDexieStorage(localNamespaceFor(branch, accountId)),
      ),
      server: makeAccountGatedStorage(accountGate, () => server),
    }
  }

  // One registry per runtime: a module's model lives as long as the runtime does.
  const moduleRegistry = makeModuleRegistry({
    makeContext: (module) => ({
      moduleId: module.id,
      storage: Object.fromEntries(
        module.scopes.map((scope) => [
          scope,
          makeBranchStorage({ owner: 'module', id: module.id, scope }),
        ]),
      ) as { [S in ModuleScope]: ScopedStorage },
      api: makeModuleApi({ moduleId: module.id, http }),
      timer: getServerTime(),
      identity,
    }),
  })

  return {
    identity,
    makeScopedStorage: makeScoped,
    makeBranchStorage,
    makeWidgetModules: (declared) => moduleRegistry.forWidget(declared),
    makeWidgetStorage: ({ instanceId, typeId }) => ({
      instance: makeScoped(instanceNamespace(instanceId)),
      shared: makeScoped(typeNamespace(typeId)),
      account: makeBranchStorage({ owner: 'widget', id: typeId, scope: 'account' }),
    }),
    makeWidgetApi: ({ instanceId, typeId }) => makeWidgetApiWith({ instanceId, typeId, http }),
  }
}
