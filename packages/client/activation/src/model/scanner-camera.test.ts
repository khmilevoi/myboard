import { describe, expect, it, vi } from 'vitest'

import {
  buildScannerConstraints,
  CameraUnavailableError,
  chooseScannerCamera,
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
  it('asks for the 4:3 sensor shape so the camera does not crop to 16:9', () => {
    expect(buildScannerConstraints('triple')).toEqual({
      audio: false,
      video: {
        deviceId: { exact: 'triple' },
        width: { ideal: 1920 },
        aspectRatio: { ideal: 4 / 3 },
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
