import * as errore from 'errore'

import { type CameraDevice, chooseScanCamera } from './choose-camera'
import { buildScanConstraints } from './track'

export type ScanMediaDevices = Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>

export class ScanCameraUnavailableError extends errore.createTaggedError({
  name: 'ScanCameraUnavailableError',
  message: 'Scan camera unavailable: $reason',
}) {}

export type ResolveScanConstraintsOptions = {
  // Opens this entry of the camera list (`videoinput` devices, in browser
  // order) instead of the automatic choice; for comparing lenses on a real
  // phone. An index past the end falls back to the automatic choice.
  cameraIndex?: number | null
}

async function listCameras(media: ScanMediaDevices): Promise<CameraDevice[]> {
  const devices = await media.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device) => ({ deviceId: device.deviceId, label: device.label }))
}

// Reads the camera list and returns constraints for the chosen device, so the
// scanner opens it directly. Labels are empty until the page has camera
// permission, so when they are, it first opens the default back camera once
// (that also asks for permission) and closes it again. When permission is
// already there (a reopened scanner, or a remembered grant) it skips that
// probe: opening and closing a second physical camera costs a second or more
// of black preview on Android. A failed probe is the same "no camera" outcome
// the scanner itself would hit.
export async function resolveScanConstraints(
  media: ScanMediaDevices | undefined,
  { cameraIndex = null }: ResolveScanConstraintsOptions = {},
): Promise<ScanCameraUnavailableError | MediaStreamConstraints> {
  if (!media?.getUserMedia) return new ScanCameraUnavailableError({ reason: 'no mediaDevices' })
  let cameras = await listCameras(media)
  if (!cameras.some((camera) => camera.label !== '')) {
    const probe = await media
      .getUserMedia(buildScanConstraints(null))
      .catch((cause: unknown) => new ScanCameraUnavailableError({ reason: 'access denied', cause }))
    if (probe instanceof Error) return probe
    probe.getTracks().forEach((track) => track.stop())
    cameras = await listCameras(media)
  }
  const forced = cameraIndex === null ? undefined : cameras[cameraIndex]?.deviceId
  return buildScanConstraints(forced || chooseScanCamera(cameras))
}
