import { ofeliaToModuleMigration } from './ofelia-to-module'
import type { Migration } from './runner'

export { MigrationFailedError, migrationKey, runMigrations, type Migration } from './runner'

export const productionMigrations: readonly Migration[] = [ofeliaToModuleMigration]
