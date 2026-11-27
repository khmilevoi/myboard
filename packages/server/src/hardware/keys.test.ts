import { describe, expect, it } from 'vitest'

import {
  bindingsKey,
  commandKey,
  GATEWAY_CODE_KEY,
  GATEWAY_IDS_KEY,
  gatewayKey,
  gatewayTokenKey,
  HARDWARE_IDS_KEY,
  hardwareKey,
  pairingKey,
  scanKey,
} from './keys'

describe('hw: keys (persistence contract)', () => {
  it('keeps the exact shapes', () => {
    expect(GATEWAY_CODE_KEY).toBe('hw:gateway-code')
    expect(GATEWAY_IDS_KEY).toBe('hw:gateway-ids')
    expect(HARDWARE_IDS_KEY).toBe('hw:hardware-ids')
    expect(gatewayKey('g1')).toBe('hw:gateway:g1')
    expect(gatewayTokenKey('abc')).toBe('hw:gateway-token:abc')
    expect(hardwareKey('h1')).toBe('hw:hardware:h1')
    expect(bindingsKey('h1')).toBe('hw:bindings:h1')
    expect(scanKey('g1')).toBe('hw:scan:g1')
    expect(pairingKey('p1')).toBe('hw:pairing:p1')
    expect(commandKey('c1')).toBe('hw:command:c1')
  })
})
