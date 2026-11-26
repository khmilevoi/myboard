import * as errore from 'errore'

import type { ValkeyOps } from '../storage/valkey'

export type Migration = {
  name: string
  /**
   * Run on every boot instead of once. The marker is still written after each success, as a
   * record of the last completion, but never suppresses a later run — so `run` must be
   * idempotent. For migrations that must keep reconciling a source a rolled-back release can
   * still write to.
   */
  repeatable?: boolean
  run(ops: ValkeyOps): Promise<Error | void>
}

export class MigrationFailedError extends errore.createTaggedError({
  name: 'MigrationFailedError',
  message: 'Migration $migration failed',
}) {}

export function migrationKey(name: string): string {
  return `migration:${name}`
}

/** Runs each migration once (a `repeatable` one on every call), in order. A completion marker is
 *  written only after success; the first failure stops the run so the rest never see a
 *  half-migrated store. */
export async function runMigrations(
  ops: ValkeyOps,
  migrations: readonly Migration[],
  now: () => number,
): Promise<MigrationFailedError | void> {
  for (const migration of migrations) {
    const key = migrationKey(migration.name)
    const fail = (cause: unknown) => new MigrationFailedError({ migration: migration.name, cause })

    if (!migration.repeatable) {
      const marker = await ops.get(key).catch(fail)
      if (marker instanceof Error) return marker
      if (marker !== null) continue
    }

    const result = await migration.run(ops).catch(fail)
    if (result instanceof MigrationFailedError) return result
    if (result instanceof Error) return fail(result)

    const written = await ops.set(key, JSON.stringify({ completedAt: now() })).catch(fail)
    if (written instanceof Error) return written
  }
}
