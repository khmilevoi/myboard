import * as errore from 'errore'

// Choosing and tuning the camera the add-device QR scanner opens.
//
// A bare `facingMode: 'environment'` makes the browser open its default back
// camera, which on multi-lens phones is a single physical lens: on recent
// iPhones the main wide lens, whose minimum focus distance is ~20 cm. The
// system camera app instead runs the *virtual* multi-lens device and switches
// to the ultra-wide/macro lens up close, which is why a QR code there reads at
// arm's length while ours had to be held far away and looked zoomed in. Safari
// exposes that virtual device to the web ("Back Triple Camera", "Back Dual Wide
// Camera"), so the scanner picks it by label once camera permission makes the
// labels readable. On Android the first back camera is the main lens; the
// ultra-wide, telephoto and depth lenses that follow it are skipped.

export type CameraDevice = { deviceId: string; label: string }

// iOS virtual devices that switch lenses (and so focus close) on their own,
// best first.
const VIRTUAL_MULTI_LENS = [/triple camera/i, /dual wide camera/i, /dual camera/i]
const BACK_CAMERA = /back|rear|environment|задн|тыл|facing back/i
const SPECIAL_LENS = /ultra ?wide|tele(photo)?\b|zoom|depth|infrared|\bir\b|desk view|macro/i

// Picks the back camera to scan with, or null to fall back to the browser's own
// `facingMode: 'environment'` choice (labels unreadable, or no back camera
// recognized by label).
export function chooseScannerCamera(devices: readonly CameraDevice[]): string | null {
  const labelled = devices.filter((device) => device.label !== '' && device.deviceId !== '')
  for (const pattern of VIRTUAL_MULTI_LENS) {
    const virtual = labelled.find((device) => pattern.test(device.label))
    if (virtual) return virtual.deviceId
  }
  const back = labelled.filter((device) => BACK_CAMERA.test(device.label))
  const main = back.find((device) => !SPECIAL_LENS.test(device.label))
  return main?.deviceId ?? null
}

// 4:3 is the native sensor shape of phone cameras; asking for 16:9 (e.g.
// 1920x1080) makes the camera crop the sensor, which narrows the field of view
// like a zoom. `ideal`, never `exact`, so a camera that cannot match still opens.
export function buildScannerConstraints(deviceId: string | null): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
      width: { ideal: 1920 },
      aspectRatio: { ideal: 4 / 3 },
    },
  }
}

// The subset of a video track the tuning needs; `getCapabilities` is missing in
// Firefox and older Safari, and `focusMode` / `zoom` are non-standard there.
export type TunableTrack = {
  getCapabilities?: () => MediaTrackCapabilities & {
    focusMode?: string[]
    zoom?: { min?: number }
  }
  applyConstraints: (constraints: MediaTrackConstraints) => Promise<void>
}

// Asks the opened track for continuous autofocus and its widest zoom, where
// the browser exposes either (Chrome on Android does; Safari mostly does not).
// Best effort: a refusal leaves the stream exactly as it was.
export async function tuneScannerTrack(track: TunableTrack): Promise<void> {
  const capabilities = track.getCapabilities?.()
  if (!capabilities) return
  const advanced: Record<string, unknown> = {}
  if (capabilities.focusMode?.includes('continuous')) advanced.focusMode = 'continuous'
  if (typeof capabilities.zoom?.min === 'number') advanced.zoom = capabilities.zoom.min
  if (Object.keys(advanced).length === 0) return
  await track
    .applyConstraints({ advanced: [advanced as MediaTrackConstraintSet] })
    .catch(() => undefined)
}

export type ScannerMediaDevices = Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>

export class CameraUnavailableError extends errore.createTaggedError({
  name: 'CameraUnavailableError',
  message: 'Камера недоступна: $reason',
}) {}

// Opens the default back camera once to get permission (device labels are
// empty before it), reads the camera list, and closes it again so the scanner
// can open the chosen device. A failure here is the same "no camera" outcome
// the scanner itself would hit.
export async function resolveScannerConstraints(
  media: ScannerMediaDevices | undefined,
): Promise<CameraUnavailableError | MediaStreamConstraints> {
  if (!media?.getUserMedia) return new CameraUnavailableError({ reason: 'нет mediaDevices' })
  const probe = await media
    .getUserMedia(buildScannerConstraints(null))
    .catch((cause: unknown) => new CameraUnavailableError({ reason: 'нет доступа', cause }))
  if (probe instanceof Error) return probe
  probe.getTracks().forEach((track) => track.stop())

  const devices = await media.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
  const cameras = devices
    .filter((device) => device.kind === 'videoinput')
    .map((device) => ({ deviceId: device.deviceId, label: device.label }))
  return buildScannerConstraints(chooseScannerCamera(cameras))
}
