import { randomUUID } from 'node:crypto'

import { safeParse } from '@shared/json'
import { instanceNamespace, typeNamespace, toFullKey, toRelativeKey } from '@shared/storage/scope'
import type { WidgetServerStorage } from '@shared/widgets/contracts'
import * as errore from 'errore'
import type { z } from 'zod'

import { publishChange } from '../storage/handlers'
import { runExclusive } from '../storage/key-lock'
import type { ValkeyOps } from '../storage/valkey'

export class WidgetServerStorageError extends errore.createTaggedError({
  name: 'WidgetServerStorageError',
  message: 'Widget storage $operation failed for $key',
}) {}

export type CreateWidgetServerStorageApiOptions = {
  ops: ValkeyOps
  typeId: string
  instanceId: string
  ip: string | null
  now: () => number
  createId?: () => string
}

function storageError(operation: string, key: string, cause?: unknown) {
  return new WidgetServerStorageError({ operation, key, cause })
}

function serialize(operation: string, key: string, value: unknown) {
  const serialized = errore.try(() => JSON.stringify(value))
  if (serialized instanceof Error) return storageError(operation, key, serialized)
  if (serialized === undefined) return storageError(operation, key)
  return serialized
}

export function createWidgetServerStorageApi({
  ops,
  typeId,
  instanceId,
  ip,
  now,
  createId = randomUUID,
}: CreateWidgetServerStorageApiOptions): {
  instance: WidgetServerStorage
  shared: WidgetServerStorage
} {
  const createScope = (namespace: string): WidgetServerStorage => ({
    async get<T>(key: string, schema?: z.ZodType<T>) {
      const fullKey = toFullKey(namespace, key)
      const raw = await ops.get(fullKey).catch((cause) => storageError('get', fullKey, cause))
      if (raw instanceof Error) return raw
      if (raw === null) return null

      const parsed = safeParse(raw)
      if (parsed instanceof Error) return storageError('parse', fullKey, parsed)
      if (!schema) return parsed as T

      const validated = schema.safeParse(parsed)
      if (!validated.success) return storageError('validate', fullKey, validated.error)
      return validated.data
    },

    async set<T>(key: string, value: T, options?: { ttlMs?: number }) {
      const fullKey = toFullKey(namespace, key)
      const serialized = serialize('set', fullKey, value)
      if (serialized instanceof Error) return serialized

      const written = await ops
        .set(fullKey, serialized, options?.ttlMs)
        .catch((cause) => storageError('set', fullKey, cause))
      if (written instanceof Error) return written

      const published = await publishChange(ops, fullKey, value).catch((cause) =>
        storageError('publish', fullKey, cause),
      )
      if (published instanceof Error) return published
    },

    async delete(key: string) {
      const fullKey = toFullKey(namespace, key)
      const deleted = await ops
        .del(fullKey)
        .catch((cause) => storageError('delete', fullKey, cause))
      if (deleted instanceof Error) return deleted

      const published = await publishChange(ops, fullKey, null).catch((cause) =>
        storageError('publish', fullKey, cause),
      )
      if (published instanceof Error) return published
    },

    async has(key: string) {
      const fullKey = toFullKey(namespace, key)
      const raw = await ops.get(fullKey).catch((cause) => storageError('has', fullKey, cause))
      if (raw instanceof Error) return raw
      return raw !== null
    },

    async keys(prefix = '') {
      const fullPrefix = toFullKey(namespace, prefix)
      const keys = await ops
        .scanKeys(fullPrefix)
        .catch((cause) => storageError('keys', fullPrefix, cause))
      if (keys instanceof Error) return keys
      return keys.map((key) => toRelativeKey(namespace, key))
    },

    async append<T extends Record<string, unknown>>(
      key: string,
      entry: T,
      options?: { cap?: number },
    ) {
      const fullKey = toFullKey(namespace, key)
      return runExclusive(fullKey, async () => {
        const raw = await ops
          .get(fullKey)
          .catch((cause) => storageError('append.get', fullKey, cause))
        if (raw instanceof Error) return raw

        const parsed = raw === null ? [] : safeParse(raw)
        if (parsed instanceof Error) return storageError('append.parse', fullKey, parsed)
        if (!Array.isArray(parsed)) return storageError('append.shape', fullKey)
        const current: unknown[] = parsed

        const enriched = errore.try(() => ({ id: createId(), ts: now(), ip, ...entry }))
        if (enriched instanceof Error) return storageError('append.enrich', fullKey, enriched)

        const next = [...current, enriched]
        const value =
          options?.cap != null && next.length > options.cap
            ? next.slice(next.length - options.cap)
            : next
        const serialized = serialize('append.set', fullKey, value)
        if (serialized instanceof Error) return serialized

        const written = await ops
          .set(fullKey, serialized)
          .catch((cause) => storageError('append.set', fullKey, cause))
        if (written instanceof Error) return written

        const published = await publishChange(ops, fullKey, value).catch((cause) =>
          storageError('publish', fullKey, cause),
        )
        if (published instanceof Error) return published
      })
    },
  })

  return {
    instance: createScope(instanceNamespace(instanceId)),
    shared: createScope(typeNamespace(typeId)),
  }
}
