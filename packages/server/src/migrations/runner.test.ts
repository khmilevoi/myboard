import { describe, expect, it, vi } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { MigrationFailedError, migrationKey, runMigrations, type Migration } from './runner'

const makeOps = () => createMemoryOps(createMemoryPubSub())

describe('runMigrations', () => {
  it('runs migrations in order and writes a marker for each', async () => {
    const ops = makeOps()
    const ran: string[] = []
    const migrations: Migration[] = ['a', 'b'].map((name) => ({
      name,
      run: async () => {
        ran.push(name)
      },
    }))

    const result = await runMigrations(ops, migrations, () => 123)

    expect(result).toBeUndefined()
    expect(ran).toEqual(['a', 'b'])
    expect(await ops.get(migrationKey('a'))).toBe(JSON.stringify({ completedAt: 123 }))
    expect(await ops.get(migrationKey('b'))).toBe(JSON.stringify({ completedAt: 123 }))
  })

  it('skips migrations whose marker already exists', async () => {
    const ops = makeOps()
    const ran: string[] = []
    const migrations: Migration[] = ['a', 'b'].map((name) => ({
      name,
      run: async () => {
        ran.push(name)
      },
    }))
    await runMigrations(ops, migrations, () => 1)
    ran.length = 0

    await runMigrations(ops, migrations, () => 2)

    expect(ran).toEqual([])
  })

  it('stops at the first failure without a marker and without running the rest', async () => {
    const ops = makeOps()
    const boom = new Error('boom')
    let secondRan = false
    const migrations: Migration[] = [
      { name: 'a', run: async () => boom },
      {
        name: 'b',
        run: async () => {
          secondRan = true
        },
      },
    ]

    const result = await runMigrations(ops, migrations, () => 1)

    expect(result).toBeInstanceOf(MigrationFailedError)
    expect((result as MigrationFailedError).cause).toBe(boom)
    expect(await ops.get(migrationKey('a'))).toBeNull()
    expect(secondRan).toBe(false)
  })

  it('reruns a repeatable migration on every call and refreshes its marker', async () => {
    const ops = makeOps()
    let runs = 0
    const migrations: Migration[] = [
      {
        name: 'r',
        repeatable: true,
        run: async () => {
          runs++
        },
      },
    ]

    await runMigrations(ops, migrations, () => 1)
    await runMigrations(ops, migrations, () => 2)

    expect(runs).toBe(2)
    expect(await ops.get(migrationKey('r'))).toBe(JSON.stringify({ completedAt: 2 }))
  })

  it('turns a failing marker read into MigrationFailedError', async () => {
    const ops = makeOps()
    const boom = new Error('valkey down')
    vi.spyOn(ops, 'get').mockRejectedValue(boom)
    let ran = false
    const migrations: Migration[] = [
      {
        name: 'a',
        run: async () => {
          ran = true
        },
      },
    ]

    const result = await runMigrations(ops, migrations, () => 1)

    expect(result).toBeInstanceOf(MigrationFailedError)
    expect((result as MigrationFailedError).cause).toBe(boom)
    expect(ran).toBe(false)
  })

  it('turns a failing marker write into MigrationFailedError', async () => {
    const ops = makeOps()
    const boom = new Error('valkey down')
    vi.spyOn(ops, 'set').mockRejectedValue(boom)
    const migrations: Migration[] = [{ name: 'a', run: async () => {} }]

    const result = await runMigrations(ops, migrations, () => 1)

    expect(result).toBeInstanceOf(MigrationFailedError)
    expect((result as MigrationFailedError).migration).toBe('a')
    expect((result as MigrationFailedError).cause).toBe(boom)
  })
})
