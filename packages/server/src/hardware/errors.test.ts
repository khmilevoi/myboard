import { HardwareErrorCodeSchema } from '@shared/hardware/board-api'
import { describe, expect, it } from 'vitest'

import * as errors from './errors'

function hardwareErrors(): errors.HardwareError[] {
  const found: errors.HardwareError[] = []
  for (const value of Object.values(errors)) {
    if (typeof value !== 'function') continue
    if (value !== errors.HardwareError && !(value.prototype instanceof errors.HardwareError))
      continue
    found.push(new (value as new (args: object) => errors.HardwareError)({}))
  }
  return found
}

describe('hardware error codes', () => {
  it('every hardware error code is in the shared contract', () => {
    const all = hardwareErrors()
    expect(all.length).toBeGreaterThan(10)
    for (const error of all) {
      expect(HardwareErrorCodeSchema.safeParse(error.code).success, error.code).toBe(true)
    }
  })

  it('the shared contract has no code that no error class uses', () => {
    const used = new Set(hardwareErrors().map((error) => error.code))
    expect(new Set(HardwareErrorCodeSchema.options)).toEqual(used)
  })
})
