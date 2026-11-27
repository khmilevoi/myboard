// Constraints for opening the scan camera, and tuning the track once open, so
// the preview shows the lens's full field of view.
//
// Two crops look exactly like a zoom: asking for 16:9 (e.g. 1920x1080) makes a
// phone camera crop its 4:3 sensor, and Chrome resizes by default
// (`resizeMode: 'crop-and-scale'`), so on Android it would rather crop a 16:9
// video mode down to a requested 4:3 than open a native 4:3 mode. The scanner
// therefore asks for 4:3 and allows only native modes.

// `resizeMode` is not in lib.dom yet.
export type ScanVideoConstraints = MediaTrackConstraints & {
  resizeMode?: 'none' | 'crop-and-scale'
}

const SCAN_LONG_SIDE = 1920

// `ideal`, never `exact`, so a camera that cannot match still opens.
export function buildScanConstraints(deviceId: string | null): MediaStreamConstraints {
  const video: ScanVideoConstraints = {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
    width: { ideal: SCAN_LONG_SIDE },
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

// The constraints that put an open track into a native mode with the full
// sensor shape, or null when it is already in one (or the browser does not
// say). The sensor shape is the aspect of the largest mode the camera reports;
// a mode of any other shape is a crop of it.
export function fullSensorConstraints(track: TunableTrack): ScanVideoConstraints | null {
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

// Brings an opened track to the lens's full field of view: a native mode of
// the sensor's own shape, continuous autofocus and the widest zoom, as far as
// the browser exposes each (Chrome on Android does; Safari mostly does not).
// Best effort: every refusal leaves the stream as it was.
export async function tuneScanTrack(track: TunableTrack): Promise<void> {
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
