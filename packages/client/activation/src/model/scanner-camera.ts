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
// labels readable. On Android, Chrome labels cameras "camera <id>, facing back"
// (older builds "camera2 <id>, …") and the Camera2 id of the primary back lens
// is the lowest; the list order is not, since a OnePlus 15 lists its telephoto
// ("camera 4") first, which looked like a 3x zoom.

export type CameraDevice = { deviceId: string; label: string }

// iOS virtual devices that switch lenses (and so focus close) on their own,
// best first.
const VIRTUAL_MULTI_LENS = [/triple camera/i, /dual wide camera/i, /dual camera/i]
const BACK_CAMERA = /back|rear|environment|задн|тыл|facing back/i
const SPECIAL_LENS = /ultra ?wide|tele(photo)?\b|zoom|depth|infrared|\bir\b|desk view|macro/i
const ANDROID_CAMERA_ID = /^camera2? (\d+),/i

function androidCameraId(label: string): number {
  const match = ANDROID_CAMERA_ID.exec(label)
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY
}

// Picks the back camera to scan with, or null to fall back to the browser's own
// `facingMode: 'environment'` choice (labels unreadable, or no back camera
// recognized by label).
export function chooseScannerCamera(devices: readonly CameraDevice[]): string | null {
  const labelled = devices.filter((device) => device.label !== '' && device.deviceId !== '')
  for (const pattern of VIRTUAL_MULTI_LENS) {
    const virtual = labelled.find((device) => pattern.test(device.label))
    if (virtual) return virtual.deviceId
  }
  const plainBack = labelled.filter(
    (device) => BACK_CAMERA.test(device.label) && !SPECIAL_LENS.test(device.label),
  )
  // Lowest Android camera id first; the stable sort keeps list order for the
  // rest (labels without an id), so the first plain back camera still wins there.
  const [main] = [...plainBack].sort((a, b) => androidCameraId(a.label) - androidCameraId(b.label))
  return main?.deviceId ?? null
}

// Chrome resizes by default (`resizeMode: 'crop-and-scale'`): to honour a size
// or aspect the camera has no native mode for, it crops the frame, and on
// Android it would rather crop a 16:9 video mode than open a native 4:3 one.
// That crop narrows the field of view like a zoom, so the scanner allows only
// native camera modes. Not in lib.dom yet.
type ScannerVideoConstraints = MediaTrackConstraints & { resizeMode?: 'none' | 'crop-and-scale' }

// 4:3 is the native sensor shape of phone cameras; asking for 16:9 (e.g.
// 1920x1080) makes the camera crop the sensor, which narrows the field of view
// like a zoom. `ideal`, never `exact`, so a camera that cannot match still opens.
export function buildScannerConstraints(deviceId: string | null): MediaStreamConstraints {
  const video: ScannerVideoConstraints = {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
    width: { ideal: 1920 },
    aspectRatio: { ideal: 4 / 3 },
    resizeMode: 'none',
  }
  return { audio: false, video }
}

// The subset of a video track the tuning needs; `getCapabilities` is missing in
// Firefox and older Safari, and `focusMode` / `zoom` are non-standard there.
export type TunableTrack = {
  getCapabilities?: () => MediaTrackCapabilities & {
    focusMode?: string[]
    zoom?: { min?: number }
  }
  getSettings?: () => MediaTrackSettings
  applyConstraints: (constraints: MediaTrackConstraints) => Promise<void>
}

const SCAN_LONG_SIDE = 1920

// The constraints that put an open track into a native mode with the full
// sensor shape, or null when it is already in one (or the browser does not say).
// The sensor shape is the aspect of the largest mode the camera reports; a mode
// of any other shape is a crop of it.
export function fullSensorConstraints(track: TunableTrack): ScannerVideoConstraints | null {
  const capabilities = track.getCapabilities?.()
  const maxWidth = capabilities?.width?.max
  const maxHeight = capabilities?.height?.max
  if (!maxWidth || !maxHeight) return null
  const sensorAspect = maxWidth / maxHeight
  const settings = track.getSettings?.()
  if (settings?.width && settings.height) {
    const aspect = settings.width / settings.height
    if (Math.abs(aspect - sensorAspect) < 0.02) return null
  }
  const width = Math.min(
    maxWidth,
    Math.round(sensorAspect >= 1 ? SCAN_LONG_SIDE : SCAN_LONG_SIDE * sensorAspect),
  )
  return {
    width: { ideal: width },
    height: { ideal: Math.round(width / sensorAspect) },
    aspectRatio: { ideal: sensorAspect },
    resizeMode: 'none',
  }
}

// Brings an opened track to the camera's full field of view: a native mode of
// the sensor's own shape, continuous autofocus and the widest zoom, as far as
// the browser exposes each (Chrome on Android does; Safari mostly does not).
// Best effort: every refusal leaves the stream as it was.
export async function tuneScannerTrack(track: TunableTrack): Promise<void> {
  const capabilities = track.getCapabilities?.()
  if (!capabilities) return
  const fullSensor = fullSensorConstraints(track)
  if (fullSensor) await track.applyConstraints(fullSensor).catch(() => undefined)
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
//
// `cameraIndex` (the `?cam=` debug override) opens that entry of the camera
// list instead of the automatic choice, to compare lenses on a real phone.
export async function resolveScannerConstraints(
  media: ScannerMediaDevices | undefined,
  cameraIndex: number | null = null,
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
  const forced = cameraIndex === null ? undefined : cameras[cameraIndex]?.deviceId
  return buildScannerConstraints(forced || chooseScannerCamera(cameras))
}
