import type { z } from 'zod'
import { StorageError, type StorageApi, type StorageOptions } from '../types'
import { toFullKey, toRelativeKey } from '../scope'
import { parseValue } from '../validate'

export function createHttpStorage(
  namespace: string,
  baseUrl = "/api/storage",
): StorageApi {
  const keyUrl = (fullKey: string) =>
    `${baseUrl}/${encodeURIComponent(fullKey)}`;

  return {
    async get<T>(
      key: string,
      schema?: z.ZodType<T>,
    ): Promise<StorageError | T | null> {
      const res = await fetch(keyUrl(toFullKey(namespace, key))).catch(
        (cause) => new StorageError({ reason: 'server GET failed', cause }),
      )
      if (res instanceof Error) return res
      if (res.status === 404) return null
      if (!res.ok) return new StorageError({ reason: `server GET ${res.status}` })

      const body = await (res.json() as Promise<{ value: unknown }>).catch(
        (cause) => new StorageError({ reason: 'server GET json parse failed', cause }),
      )
      if (body instanceof Error) return body
      return parseValue(schema, body.value)
    },

    async set<T>(
      key: string,
      value: T,
      options?: StorageOptions,
    ): Promise<StorageError | void> {
      const res = await fetch(keyUrl(toFullKey(namespace, key)), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value, ttlMs: options?.ttlMs }),
      }).catch(
        (cause) => new StorageError({ reason: "server PUT failed", cause }),
      );
      if (res instanceof Error) return res;
      if (!res.ok)
        return new StorageError({ reason: `server PUT ${res.status}` });
    },

    async delete(key: string): Promise<StorageError | void> {
      const res = await fetch(keyUrl(toFullKey(namespace, key)), {
        method: "DELETE",
      }).catch(
        (cause) => new StorageError({ reason: "server DELETE failed", cause }),
      );
      if (res instanceof Error) return res;
      if (!res.ok)
        return new StorageError({ reason: `server DELETE ${res.status}` });
    },

    async has(key: string): Promise<StorageError | boolean> {
      const res = await fetch(keyUrl(toFullKey(namespace, key))).catch(
        (cause) => new StorageError({ reason: "server HAS failed", cause }),
      );
      if (res instanceof Error) return res;
      if (res.status === 404) return false;
      if (!res.ok)
        return new StorageError({ reason: `server HAS ${res.status}` });
      return true;
    },

    async keys(prefix?: string): Promise<StorageError | string[]> {
      const fullPrefix = toFullKey(namespace, prefix ?? "");
      const res = await fetch(
        `${baseUrl}?prefix=${encodeURIComponent(fullPrefix)}`,
      ).catch(
        (cause) => new StorageError({ reason: "server KEYS failed", cause }),
      );
      if (res instanceof Error) return res;
      if (!res.ok)
        return new StorageError({ reason: `server KEYS ${res.status}` });

      const body = await (res.json() as Promise<{ keys: string[] }>).catch(
        (cause) =>
          new StorageError({ reason: "server KEYS json parse failed", cause }),
      );
      if (body instanceof Error) return body;
      return body.keys.map((full) => toRelativeKey(namespace, full));
    },
  };
}
