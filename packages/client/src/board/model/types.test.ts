// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { BoardMigrationsSchema, BoardSnapshotSchema, BoardSnapshotsShema } from './types'

describe('BoardSnapshotSchema', () => {
  it("preserves a field it doesn't recognise through parse and a write round-trip", () => {
    // Simulates a client on a pre-release bundle parsing the shared `boards`
    // record after a newer field has been added to it (e.g. mobileLayout's
    // introduction) and then writing the parsed value straight back.
    // withStorageKey's change hook PUTs exactly the atom's current value,
    // which came from this schema's parse — so anything dropped here is
    // permanently lost the moment this client makes its next local edit.
    const record = {
      id: 'b1',
      name: 'Board',
      instances: [],
      layout: [],
      futureField: { some: 'data-from-a-newer-release' },
    }

    const parsed = BoardSnapshotSchema.parse(record)
    expect(parsed).toMatchObject({ futureField: record.futureField })

    // The write path serializes the parsed value straight to the wire; round
    // trip it the same way and confirm the field survived.
    const roundTripped = JSON.parse(JSON.stringify(parsed))
    expect(roundTripped.futureField).toEqual(record.futureField)
  })

  it('preserves an unknown field on each item of the shared boards array', () => {
    const records = [
      {
        id: 'b1',
        name: 'Board',
        instances: [],
        layout: [],
        futureField: 'from-a-newer-release',
      },
    ]

    const parsed = BoardSnapshotsShema.parse(records)

    expect(parsed[0]).toMatchObject({ futureField: 'from-a-newer-release' })
  })
})

describe('BoardMigrationsSchema', () => {
  it('round-trips the applied migration ids per board through parse and a write', () => {
    // migrateBoardLayoutHeights (mobile-layout.ts) records applied migration
    // ids here — deliberately its own storage key rather than a field on
    // BoardSnapshot, precisely so an old bundle that has never heard of this
    // key cannot strip it the way it strips an unrecognised BoardSnapshot
    // field. See board-storage.ts's localBoardMigrations/sharedBoardMigrations
    // for why. If this record were ever lost, every load would look
    // unmigrated again and a deliberate post-migration shrink below the new
    // default would be silently reverted on the next read.
    const record = { b1: ['layout-height-floor-v1'] }

    const parsed = BoardMigrationsSchema.parse(record)
    expect(parsed).toEqual({ b1: ['layout-height-floor-v1'] })

    const roundTripped = JSON.parse(JSON.stringify(parsed))
    expect(roundTripped).toEqual({ b1: ['layout-height-floor-v1'] })
  })
})
