import {
  action,
  atom,
  AtomState,
  Ext,
  withAsync,
  withChangeHook,
  withConnectHook,
  wrap,
} from "@reatom/core";
import type { z } from "zod";
import { clearExpired } from "../client/db";
import type { StorageApi, StorageError, StorageOptions } from "../types";
import { Atom } from "@reatom/core";

/**
 * Status-tracked mutations over a StorageApi. The underlying api returns errors
 * as values; we re-throw them so withAsync captures them in `.error()`/`.status()`.
 */
export function reatomStorageMutations(api: StorageApi, name: string) {
  const set = action(
    async (key: string, value: unknown, options?: StorageOptions) => {
      const result = await wrap(api.set(key, value, options));
      if (result instanceof Error) throw result;
    },
    `${name}.set`,
  ).extend(withAsync({ status: true }));

  const remove = action(async (key: string) => {
    const result = await wrap(api.delete(key));
    if (result instanceof Error) throw result;
  }, `${name}.remove`).extend(withAsync({ status: true }));

  return { set, remove };
}

/** Action that purges expired client (Dexie) rows. */
export function reatomClearExpired(name: string) {
  return action(async () => {
    await wrap(clearExpired());
  }, `${name}.clearExpired`).extend(withAsync());
}

export type WithStorageKeyOptions<T> = {
  api: StorageApi;
  key: string;
  schema?: z.ZodType<T>;
};

export type StorageKeyExt<State> = {
  asyncValue: Atom<State | null>;
  error: Atom<StorageError | null>;
};

/** Reactive value of a single key over StorageApi.subscribe. */
export const withStorageKey =
  <Target extends Atom>({
    api,
    key,
    schema,
  }: WithStorageKeyOptions<AtomState<Target>>): Ext<
    Target,
    StorageKeyExt<AtomState<Target>>
  > =>
  (target) => {
    const asyncValue = atom<AtomState<Target> | null>(
      null,
      `${target.name}.value`,
    );
    const error = atom<StorageError | null>(null, `${target.name}.error`);

    target.extend(
      withConnectHook(() => {
        api.subscribe<AtomState<Target>>(
          key,
          wrap((event) => {
            if (event instanceof Error) return error.set(event);
            error.set(null);
            asyncValue.set(event.value);
            target.set(event.value);
          }),
          schema,
        );
      }),
      withChangeHook((state, prevState) => {
        target.set(state);
        api.set(key, state, state).then((err) => {
          if (err instanceof Error) {
            error.set(err);
            target.set(prevState);
          }
        });
      }),
    );

    return {
      asyncValue,
      error,
    };
  };
