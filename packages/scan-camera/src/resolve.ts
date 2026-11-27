import * as errore from 'errore'

import { chooseScanCamera } from './choose-camera'
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

// Opens the default back camera once to get permission (device labels are
// empty before it), reads the camera list, and closes it again, so the scanner
// can open the chosen device directly. A failure here is the same "no camera"
// outcome the scanner itself would hit.
export async function resolveScanConstraints(
  media: ScanMediaDevices | undefined,
  { cameraIndex = null }: ResolveScanConstraintsOptions = {},
): Promise<ScanCameraUnavailableError | MediaStreamConstraints> {
  if (!media?.getUserMedia) return new ScanCameraUnavailableError({ reason: 'no mediaDevices' })
  const probe = await media
    .getUserMedia(buildScanConstraints(null))
    .catch((cause: unknown) => new ScanCameraUnavailableError({ reason: 'access denied', cause }))
  if (probe instanceof Error) return probe
  probe.getTracks().forEach((track) => track.stop())

  const devices = await media.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
  const cameras = devices
    .filter((device) => device.kind === 'videoinput')
    .map((device) => ({ deviceId: device.deviceId, label: device.label }))
  const forced = cameraIndex === null ? undefined : cameras[cameraIndex]?.deviceId
  return buildScanConstraints(forced || chooseScanCamera(cameras))
}
