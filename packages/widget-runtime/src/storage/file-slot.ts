import { action, atom, withConnectHook, wrap, type Action, type Atom } from '@reatom/core'
import {
  FILE_NAME_HEADER,
  FileRefSchema,
  fileSlotRelativeKey,
  scopedFilePath,
  type FileRef,
} from '@shared/files/contract'
import type { HttpLike } from '@shared/http/client'
import {
  EXPECTED_ACCOUNT_HEADER,
  isValidRelativeKey,
  type ScopedStorageRef,
  type ValidScopedBranch,
} from '@shared/storage/scoped'
import { z } from 'zod'

import type { AccountGate } from './account-gate'
import type { SseDeliver } from './server/sse-client'
import { subscribeStorageKey } from './subscribe-key'
import { StorageError, type StorageListener } from './types'

export type FileUploadOptions = {
  /** The original file name, stored on the ref and used for downloads. */
  name?: string
}

/**
 * One file slot: a storage key whose value is a `FileRef` (bytes live in the blob store, never in
 * Valkey). `ref` loads with a GET when first subscribed and then follows the slot over SSE.
 * Uploads are online-only: an offline or failed upload is a `StorageError` value, never a queued
 * write.
 */
export type FileSlot = {
  /** The slot's current file; null while empty, still loading, or unavailable. */
  ref: Atom<FileRef | null>
  /** The last load or subscription failure; null while the slot is healthy. */
  error: Atom<StorageError | null>
  /** True until the first load (or failure) after connecting. */
  isLoading: Atom<boolean>
  upload: Action<[blob: Blob, options?: FileUploadOptions], Promise<StorageError | FileRef>>
  remove: Action<[], Promise<StorageError | void>>
}

/** The transport under a `FileSlot`, errors as values. */
export type FileSlotApi = {
  get(): Promise<StorageError | FileRef | null>
  upload(blob: Blob, options?: FileUploadOptions): Promise<StorageError | FileRef>
  remove(): Promise<StorageError | void>
  subscribe(listener: StorageListener<FileRef>): () => void
}

export type HttpFileSlotApiDeps = {
  branch: ValidScopedBranch
  key: string
  http: HttpLike
  registerScoped: (ref: ScopedStorageRef, deliver: SseDeliver, account?: string) => () => void
  /** The account an account-branch slot serves: sent as the expected-account header, tagged onto SSE. */
  account?: string
}

const ValueEnvelopeSchema = z.object({ value: FileRefSchema.nullable() })

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/** A slot over `/api/files/scoped/...`, the same branch resolution as scoped storage. */
export function makeHttpFileSlotApi({
  branch,
  key,
  http,
  registerScoped,
  account,
}: HttpFileSlotApiDeps): FileSlotApi {
  const url = scopedFilePath(branch, key)
  // The reason never embeds the key: it is caller-supplied text that would leak into logs.
  const invalidKey = () => new StorageError({ reason: 'invalid_key' })
  const accountHeaders: Record<string, string> =
    account === undefined ? {} : { [EXPECTED_ACCOUNT_HEADER]: account }
  const validKey = isValidRelativeKey(key)

  const get = async (): Promise<StorageError | FileRef | null> => {
    if (!validKey) return invalidKey()
    const res = await http.get(url, { headers: accountHeaders })
    if (res instanceof Error) return new StorageError({ reason: 'file GET failed', cause: res })
    if (!res.ok) return new StorageError({ reason: `file GET ${res.status}` })
    const envelope = ValueEnvelopeSchema.safeParse(res.body)
    if (!envelope.success) {
      return new StorageError({ reason: 'file GET invalid response', cause: envelope.error })
    }
    return envelope.data.value
  }

  return {
    get,

    async upload(blob, options = {}) {
      if (!validKey) return invalidKey()
      if (isOffline()) return new StorageError({ reason: 'offline' })
      const headers: Record<string, string> = {
        ...accountHeaders,
        'content-type': blob.type || 'application/octet-stream',
      }
      if (options.name) headers[FILE_NAME_HEADER] = encodeURIComponent(options.name)
      const res = await http.put(url, { headers, body: blob })
      if (res instanceof Error) {
        return new StorageError({ reason: 'file upload failed', cause: res })
      }
      if (!res.ok) return new StorageError({ reason: `file upload ${res.status}` })
      const envelope = z.object({ value: FileRefSchema }).safeParse(res.body)
      if (!envelope.success) {
        return new StorageError({ reason: 'file upload invalid response', cause: envelope.error })
      }
      return envelope.data.value
    },

    async remove() {
      if (!validKey) return invalidKey()
      if (isOffline()) return new StorageError({ reason: 'offline' })
      const res = await http.delete(url, { headers: accountHeaders })
      if (res instanceof Error)
        return new StorageError({ reason: 'file remove failed', cause: res })
      if (!res.ok) return new StorageError({ reason: `file remove ${res.status}` })
    },

    subscribe(listener) {
      if (!validKey) {
        // Never register an invalid ref: the server rejects the whole events POST atomically.
        let active = true
        void Promise.resolve().then(() => {
          if (active) listener(invalidKey())
        })
        return () => {
          active = false
        }
      }
      return subscribeStorageKey({
        getCurrent: get,
        register: (deliver) =>
          registerScoped({ ...branch, key: fileSlotRelativeKey(key) }, deliver, account),
        listener,
        schema: FileRefSchema,
      })
    },
  }
}

/**
 * A slot that exists only while an account is known — the file-slot twin of
 * `makeAccountGatedStorage`: direct operations without an account return `account_unavailable` at
 * once; a subscription waits for the account and follows it across switches. One built api is
 * cached per account.
 */
export function makeAccountGatedFileSlotApi(
  gate: AccountGate,
  build: (accountId: string) => FileSlotApi,
): FileSlotApi {
  const built = new Map<string, FileSlotApi>()
  const apiFor = (accountId: string): FileSlotApi => {
    const cached = built.get(accountId)
    if (cached) return cached
    const api = build(accountId)
    built.set(accountId, api)
    return api
  }
  const current = (): FileSlotApi | null => {
    const accountId = gate.current()
    return accountId === null ? null : apiFor(accountId)
  }
  const unavailable = () => new StorageError({ reason: 'account_unavailable' })

  return {
    async get() {
      const api = current()
      if (!api) return unavailable()
      return api.get()
    },
    async upload(blob, options) {
      const api = current()
      if (!api) return unavailable()
      return api.upload(blob, options)
    },
    async remove() {
      const api = current()
      if (!api) return unavailable()
      return api.remove()
    },
    subscribe(listener) {
      let active: string | null = null
      let unsubscribeInner: (() => void) | undefined
      let closed = false

      const unsubscribeGate = gate.subscribe((accountId) => {
        if (closed || accountId === active) return
        unsubscribeInner?.()
        unsubscribeInner = undefined
        // Another account's file must not linger in the slot while the new one loads.
        if (active !== null) listener({ value: null })
        active = accountId
        if (accountId !== null) unsubscribeInner = apiFor(accountId).subscribe(listener)
      })

      return () => {
        if (closed) return
        closed = true
        unsubscribeGate()
        unsubscribeInner?.()
        unsubscribeInner = undefined
      }
    },
  }
}

export type MakeFileSlotOptions = Omit<HttpFileSlotApiDeps, 'account'> & {
  /** Required for an account branch: the slot follows the viewer's account through it. */
  accountGate?: AccountGate
  /** Prefix for the atom and action names. */
  name?: string
}

const NO_ACCOUNT_GATE: AccountGate = {
  current: () => null,
  subscribe: (listener) => {
    listener(null)
    return () => {}
  },
}

/** A reactive file slot on one scoped branch. Cheap to build: nothing is requested until `ref` is subscribed. */
export function makeFileSlot({ accountGate, name, ...deps }: MakeFileSlotOptions): FileSlot {
  const api =
    deps.branch.scope === 'account'
      ? makeAccountGatedFileSlotApi(accountGate ?? NO_ACCOUNT_GATE, (account) =>
          makeHttpFileSlotApi({ ...deps, account }),
        )
      : makeHttpFileSlotApi(deps)
  const { owner, id, scope } = deps.branch
  return makeFileSlotFromApi(api, name ?? `fileSlot.${owner}.${id}.${scope}.${deps.key}`)
}

/** The reactive face of a `FileSlotApi`; exported for fakes and harnesses. */
export function makeFileSlotFromApi(api: FileSlotApi, name: string): FileSlot {
  const error = atom<StorageError | null>(null, `${name}.error`)
  const isLoading = atom(true, `${name}.isLoading`)
  const ref = atom<FileRef | null>(null, `${name}.ref`).extend(
    withConnectHook(() => {
      isLoading.set(true)
      return api.subscribe(
        wrap((event) => {
          if (event instanceof Error) {
            isLoading.set(false)
            error.set(event)
            return
          }
          error.set(null)
          ref.set(event.value)
          // The gated api emits a bare null on an account switch before the new account's load.
          isLoading.set(false)
        }),
      )
    }),
  )

  const upload = action(async (blob: Blob, options?: FileUploadOptions) => {
    const result = await wrap(api.upload(blob, options))
    if (result instanceof Error) return result
    // SSE delivers the same ref; applying it now keeps the uploader's view immediate.
    ref.set(result)
    return result
  }, `${name}.upload`)

  const remove = action(async () => {
    const result = await wrap(api.remove())
    if (result instanceof Error) return result
    ref.set(null)
  }, `${name}.remove`)

  return { ref, error, isLoading, upload, remove }
}
