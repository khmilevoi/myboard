/**
 * In-process per-key serialization. Each task waits for the previous task on the
 * same key to settle; different keys are independent.
 */
const tails = new Map<string, Promise<unknown>>();

export function runExclusive<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const result = previous.then(() => task());
  const tail = result
    .catch(() => null)
    .finally(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });

  tails.set(key, tail);

  return result;
}
