import { describe, expect, it, vi } from 'vitest'

import {
  buildScannerConstraints,
  CameraUnavailableError,
  chooseScannerCamera,
  fullSensorConstraints,
  resolveScannerConstraints,
  tuneScannerTrack,
} from './scanner-camera'

const cam = (deviceId: string, label: string) => ({ deviceId, label })

describe('chooseScannerCamera', () => {
  it('prefers the iPhone virtual multi-lens camera, which focuses close like the system camera', () => {
    const devices = [
      cam('front', 'Front Camera'),
      cam('wide', 'Back Camera'),
      cam('ultra', 'Back Ultra Wide Camera'),
      cam('tele', 'Back Telephoto Camera'),
      cam('dualwide', 'Back Dual Wide Camera'),
      cam('triple', 'Back Triple Camera'),
    ]

    expect(chooseScannerCamera(devices)).toBe('triple')
    expect(chooseScannerCamera(devices.filter((d) => d.deviceId !== 'triple'))).toBe('dualwide')
  })

  it('takes the first plain back camera on Android, skipping special lenses', () => {
    const devices = [
      cam('f', 'camera2 1, facing front'),
      cam('b0', 'camera2 0, facing back'),
      cam('b2', 'camera2 2, facing back'),
    ]

    expect(chooseScannerCamera(devices)).toBe('b0')
    expect(chooseScannerCamera([cam('u', 'Back Ultra Wide Camera'), cam('w', 'Back Camera')])).toBe(
      'w',
    )
  })

  it('falls back to the browser choice when labels are unreadable or no back camera is named', () => {
    expect(chooseScannerCamera([cam('a', ''), cam('b', '')])).toBeNull()
    expect(chooseScannerCamera([cam('w', 'Integrated Webcam')])).toBeNull()
  })
})

describe('buildScannerConstraints', () => {
  it('asks for a native 4:3 mode so neither the camera nor Chrome crops to 16:9', () => {
    expect(buildScannerConstraints('triple')).toEqual({
      audio: false,
      video: {
        deviceId: { exact: 'triple' },
        width: { ideal: 1920 },
        aspectRatio: { ideal: 4 / 3 },
        resizeMode: 'none',
      },
    })
    expect(buildScannerConstraints(null).video).toMatchObject({
      facingMode: { ideal: 'environment' },
    })
  })
})

describe('tuneScannerTrack', () => {
  it('requests continuous focus and the widest zoom when the track supports them', async () => {
    const applyConstraints = vi.fn(async () => {})
    await tuneScannerTrack({
      getCapabilities: () => ({ focusMode: ['manual', 'continuous'], zoom: { min: 1 } }),
      applyConstraints,
    })

    expect(applyConstraints).toHaveBeenCalledWith({
      advanced: [{ focusMode: 'continuous', zoom: 1 }],
    })
  })

  it('switches a cropped mode to a native mode of the full sensor shape', async () => {
    const applyConstraints = vi.fn(async () => {})
    await tuneScannerTrack({
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

  it('keeps a mode that already has the full sensor shape', () => {
    expect(
      fullSensorConstraints({
        getCapabilities: () => ({ width: { max: 4000 }, height: { max: 3000 } }),
        getSettings: () => ({ width: 1440, height: 1080 }),
        applyConstraints: async () => {},
      }),
    ).toBeNull()
  })

  it('leaves the track alone without capabilities and swallows a refusal', async () => {
    const applyConstraints = vi.fn(async () => {
      throw new Error('OverconstrainedError')
    })
    await tuneScannerTrack({ applyConstraints })
    expect(applyConstraints).not.toHaveBeenCalled()

    await expect(
      tuneScannerTrack({ getCapabilities: () => ({ zoom: { min: 0.5 } }), applyConstraints }),
    ).resolves.toBeUndefined()
  })
})

describe('resolveScannerConstraints', () => {
  it('opens a permission probe, closes it, and targets the chosen device', async () => {
    const stop = vi.fn()
    const media = {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream),
      enumerateDevices: vi.fn(
        async () =>
          [
            { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' },
            { kind: 'videoinput', deviceId: 'wide', label: 'Back Camera' },
            { kind: 'videoinput', deviceId: 'triple', label: 'Back Triple Camera' },
          ] as MediaDeviceInfo[],
      ),
    }

    const constraints = await resolveScannerConstraints(media)

    expect(stop).toHaveBeenCalledOnce()
    expect(constraints).toEqual(buildScannerConstraints('triple'))
  })

  it('opens the camera the ?cam= override names, falling back on a bad index', async () => {
    const media = {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream),
      enumerateDevices: vi.fn(
        async () =>
          [
            { kind: 'videoinput', deviceId: 'front', label: 'camera2 1, facing front' },
            { kind: 'videoinput', deviceId: 'main', label: 'camera2 0, facing back' },
          ] as MediaDeviceInfo[],
      ),
    }

    expect(await resolveScannerConstraints(media, 0)).toEqual(buildScannerConstraints('front'))
    expect(await resolveScannerConstraints(media, 7)).toEqual(buildScannerConstraints('main'))
  })

  it('reports an unavailable camera when permission is denied or there is no mediaDevices', async () => {
    const denied = await resolveScannerConstraints({
      getUserMedia: vi.fn(async () => {
        throw new DOMException('denied', 'NotAllowedError')
      }),
      enumerateDevices: vi.fn(async () => []),
    })

    expect(denied).toBeInstanceOf(CameraUnavailableError)
    expect(await resolveScannerConstraints(undefined)).toBeInstanceOf(CameraUnavailableError)
  })
})
