import { describe, expect, it, vi } from 'vitest'

import { buildScanConstraints, fullSensorConstraints, tuneScanTrack } from './track'

describe('buildScanConstraints', () => {
  it('asks for a native 4:3 mode so neither the camera nor Chrome crops to 16:9', () => {
    expect(buildScanConstraints('main')).toEqual({
      audio: false,
      video: {
        deviceId: { exact: 'main' },
        width: { ideal: 1920 },
        aspectRatio: { ideal: 4 / 3 },
        resizeMode: 'none',
      },
    })
    expect(buildScanConstraints(null).video).toMatchObject({
      facingMode: { ideal: 'environment' },
    })
  })
})

describe('fullSensorConstraints', () => {
  it('keeps a mode that already has the full sensor shape', () => {
    expect(
      fullSensorConstraints({
        getCapabilities: () => ({ width: { max: 4096 }, height: { max: 3072 } }),
        getSettings: () => ({ width: 1920, height: 1440 }),
        applyConstraints: async () => {},
      }),
    ).toBeNull()
  })

  it('says nothing when the browser does not report the largest mode', () => {
    expect(
      fullSensorConstraints({ getCapabilities: () => ({}), applyConstraints: async () => {} }),
    ).toBeNull()
  })
})

describe('tuneScanTrack', () => {
  it('switches a cropped mode to a native mode of the full sensor shape', async () => {
    const applyConstraints = vi.fn(async () => {})
    await tuneScanTrack({
      getCapabilities: () => ({ width: { max: 4000 }, height: { max: 3000 } }),
      getSettings: () => ({ width: 1920, height: 1080 }),
      applyConstraints,
    })

    expect(applyConstraints).toHaveBeenCalledWith({
      width: { ideal: 1920 },
      height: { ideal: 1440 },
      aspectRatio: { ideal: 4 / 3 },
      resizeMode: 'none',
    })
  })

  it('requests continuous focus and the widest zoom when the track supports them', async () => {
    const applyConstraints = vi.fn(async () => {})
    await tuneScanTrack({
      getCapabilities: () => ({ focusMode: ['manual', 'continuous'], zoom: { min: 1 } }),
      applyConstraints,
    })

    expect(applyConstraints).toHaveBeenCalledWith({
      advanced: [{ focusMode: 'continuous', zoom: 1 }],
    })
  })

  it('leaves the track alone without capabilities and swallows a refusal', async () => {
    const applyConstraints = vi.fn(async () => {
      throw new Error('OverconstrainedError')
    })
    await tuneScanTrack({ applyConstraints })
    expect(applyConstraints).not.toHaveBeenCalled()

    await expect(
      tuneScanTrack({ getCapabilities: () => ({ zoom: { min: 0.5 } }), applyConstraints }),
    ).resolves.toBeUndefined()
  })
})
