import { ZodType } from "zod";
import {
  StorageError,
  type StorageApi,
  type StorageEntry,
  type StorageOptions,
} from "../types";
import { toFullKey, toRelativeKey } from "../scope";
import { db as defaultDb, type StorageDb } from "./db";

export function createDexieStorage(
  namespace: string,
  database: StorageDb = defaultDb,
): StorageApi {
  const table = database.entries;

  async function readValid(
    fullKey: string,
  ): Promise<StorageError | StorageEntry | null> {
    const row = await table
      .get(fullKey)
      .catch(
        (cause) => new StorageError({ reason: "dexie read failed", cause }),
      );
    if (row instanceof Error) return row;
    if (!row) return null;
    if (row.expiresAt != null && row.expiresAt < Date.now()) {
      const delResult = await table
        .delete(fullKey)
        .catch(
          (cause) =>
            new StorageError({ reason: "dexie read cleanup failed", cause }),
        );
      if (delResult instanceof Error) return delResult;
      return null;
    }
    return row;
  }

  return {
    async get<T>(
      key: string,
      schema?: ZodType<T>,
    ): Promise<StorageError | T | null> {
      const row = await readValid(toFullKey(namespace, key));
      if (row instanceof Error) return row;

      if (!schema) return row === null ? null : (row.value as T);

      const parsed = schema.safeParse(row?.value);

      if (parsed.error)
        return new StorageError({
          reason: "dexie read failed",
          cause: parsed.error,
        });

      return parsed.data;
    },

    async set<T>(
      key: string,
      value: T,
      options?: StorageOptions,
    ): Promise<StorageError | void> {
      const now = Date.now();
      const entry: StorageEntry<T> = {
        key: toFullKey(namespace, key),
        namespace,
        value,
        expiresAt: options?.ttlMs != null ? now + options.ttlMs : null,
        updatedAt: now,
      };
      const result = await table
        .put(entry)
        .catch(
          (cause) => new StorageError({ reason: "dexie write failed", cause }),
        );
      if (result instanceof Error) return result;
    },

    async delete(key: string): Promise<StorageError | void> {
      const result = await table
        .delete(toFullKey(namespace, key))
        .catch(
          (cause) => new StorageError({ reason: "dexie delete failed", cause }),
        );
      if (result instanceof Error) return result;
    },

    async has(key: string): Promise<StorageError | boolean> {
      const row = await readValid(toFullKey(namespace, key));
      if (row instanceof Error) return row;
      return row !== null;
    },

    async keys(prefix?: string): Promise<StorageError | string[]> {
      const fullPrefix = toFullKey(namespace, prefix ?? "");
      const rows = await table
        .where("key")
        .startsWith(fullPrefix)
        .toArray()
        .catch(
          (cause) => new StorageError({ reason: "dexie keys failed", cause }),
        );
      if (rows instanceof Error) return rows;
      const now = Date.now();
      return rows
        .filter((row) => row.expiresAt == null || row.expiresAt >= now)
        .map((row) => toRelativeKey(namespace, row.key));
    },
  };
}
