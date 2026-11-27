import { describe, expect, it, vi } from 'vitest'

import { resolveScanConstraints, ScanCameraUnavailableError } from './resolve'
import { buildScanConstraints } from './track'

// A browser whose camera labels stay empty until the page has opened a camera
// once (`granted: false`), or are readable from the start (`granted: true`).
function fakeMedia(
  cameras: { deviceId: string; label: string }[],
  { granted = false, stop = vi.fn() } = {},
) {
  let permitted = granted
  return {
    getUserMedia: vi.fn(async () => {
      permitted = true
      return { getTracks: () => [{ stop }] } as unknown as MediaStream
    }),
    enumerateDevices: vi.fn(
      async () =>
        [
          { kind: 'audioinput', deviceId: 'mic', label: permitted ? 'Microphone' : '' },
          ...cameras.map((camera) => ({
            kind: 'videoinput',
            deviceId: camera.deviceId,
            label: permitted ? camera.label : '',
          })),
        ] as MediaDeviceInfo[],
    ),
  }
}

describe('resolveScanConstraints', () => {
  it('opens a permission probe, closes it, and targets the chosen device', async () => {
    const stop = vi.fn()
    const media = fakeMedia(
      [
        { deviceId: 'b4', label: 'camera 4, facing back' },
        { deviceId: 'b0', label: 'camera 0, facing back' },
      ],
      { stop },
    )

    const constraints = await resolveScanConstraints(media)

    expect(media.getUserMedia).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
    expect(constraints).toEqual(buildScanConstraints('b0'))
  })

  it('skips the probe when labels are already readable, so no second camera opens', async () => {
    const media = fakeMedia(
      [
        { deviceId: 'b4', label: 'camera 4, facing back' },
        { deviceId: 'b0', label: 'camera 0, facing back' },
      ],
      { granted: true },
    )

    expect(await resolveScanConstraints(media)).toEqual(buildScanConstraints('b0'))
    expect(media.getUserMedia).not.toHaveBeenCalled()
  })

  it('opens the camera a cameraIndex names, falling back on an index past the end', async () => {
    const media = fakeMedia([
      { deviceId: 'front', label: 'camera 1, facing front' },
      { deviceId: 'main', label: 'camera 0, facing back' },
    ])

    expect(await resolveScanConstraints(media, { cameraIndex: 0 })).toEqual(
      buildScanConstraints('front'),
    )
    expect(await resolveScanConstraints(media, { cameraIndex: 7 })).toEqual(
      buildScanConstraints('main'),
    )
  })

  it('reports an unavailable camera when permission is denied or there is no mediaDevices', async () => {
    const denied = await resolveScanConstraints({
      getUserMedia: vi.fn(async () => {
        throw new DOMException('denied', 'NotAllowedError')
      }),
      enumerateDevices: vi.fn(async () => []),
    })

    expect(denied).toBeInstanceOf(ScanCameraUnavailableError)
    expect(await resolveScanConstraints(undefined)).toBeInstanceOf(ScanCameraUnavailableError)
  })
})
