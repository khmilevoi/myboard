import { describe, expect, it } from 'vitest'

import { parseHardwareFrame } from './board-events'

describe('parseHardwareFrame', () => {
  it('parses a hardware frame into its event', () => {
    const data = JSON.stringify({ key: 'hw:events', value: { type: 'changed' } })
    expect(parseHardwareFrame(data)).toEqual({ type: 'changed' })
  })

  it('ignores a frame of another key', () => {
    const data = JSON.stringify({ key: 'other', value: { type: 'changed' } })
    expect(parseHardwareFrame(data)).toBeNull()
  })

  it('ignores a value the schema rejects', () => {
    const data = JSON.stringify({ key: 'hw:events', value: { type: 'nope' } })
    expect(parseHardwareFrame(data)).toBeNull()
  })

  it('ignores broken JSON', () => {
    expect(parseHardwareFrame('{not json')).toBeNull()
  })
})
