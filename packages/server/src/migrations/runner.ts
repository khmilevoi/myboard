import * as errore from 'errore'

import type { ValkeyOps } from '../storage/valkey'

export type Migration = {
  name: string
  run(ops: ValkeyOps): Promise<Error | void>
}

export class MigrationFailedError extends errore.createTaggedError({
  name: 'MigrationFailedError',
  message: 'Migration $migration failed',
}) {}

export function migrationKey(name: string): string {
  return `migration:${name}`
}

/** Runs each migration once, in order. A completion marker is written only after
 *  success; the first failure stops the run so the rest never see a half-migrated store. */
export async function runMigrations(
  ops: ValkeyOps,
  migrations: readonly Migration[],
  now: () => number,
): Promise<MigrationFailedError | void> {
  for (const migration of migrations) {
    const key = migrationKey(migration.name)
    if ((await ops.get(key)) !== null) continue

    const result = await migration
      .run(ops)
      .catch((e) => new MigrationFailedError({ migration: migration.name, cause: e }))
    if (result instanceof MigrationFailedError) return result
    if (result instanceof Error) {
      return new MigrationFailedError({ migration: migration.name, cause: result })
    }

    await ops.set(key, JSON.stringify({ completedAt: now() }))
  }
}
