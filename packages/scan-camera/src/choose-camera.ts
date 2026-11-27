// Picking the back camera a close-range scanner (QR codes, barcodes) should
// open. Browsers expose no lens type, only a label, so this reads labels:
//
// - iOS Safari exposes the *virtual* multi-lens devices the system camera app
//   runs ("Back Dual Wide Camera", "Back Triple Camera"). They hop to the
//   ultra-wide/macro lens up close on their own, so a code reads at arm's
//   length; the single wide lens ("Back Camera") cannot focus nearer than
//   ~20 cm. iOS translates these labels into the system language, so they are
//   matched by word stems in several languages, not by the English names.
// - Chrome on Android labels cameras "camera <id>, facing back" (older builds
//   "camera2 <id>, …"), untranslated. The Camera2 id of the primary back lens
//   is the lowest, but the list order is not: a OnePlus 15 lists
//   "camera 4, 3, 2, 0", and camera 4 is its telephoto.

export type CameraDevice = { deviceId: string; label: string }

// Case-insensitive word stems in English, Russian, Ukrainian, Polish, German,
// French, Spanish and Italian. Extend a list when a phone in another language
// picks the wrong lens.
const TRIPLE = /triple|tripla|dreifach|тройн|потрійн|potrójn/i
const DUAL = /dual|double|doble|doppi|двойн|двоен|здвоєн|подвійн|podwójn|dwuobiektyw/i
const WIDE = /wide|широк|szerokokąt|weitwinkel|grand angle|gran angular|grandangol/i
const BACK = /back|rear|environment|задн|тыл|tyln|rück|arrière|trasera|posterior/i
// Lenses that are wrong for scanning on their own: ultra-wide (soft, distorted
// at the edges), telephoto (a fixed zoom), and the non-imaging sensors.
const SPECIAL_LENS =
  /ultra|сверхширок|надширок|tele|теле|zoom|depth|infrared|\bir\b|desk view|macro/i
const ANDROID_CAMERA_ID = /^camera2? (\d+),/i

function isDualWide(label: string): boolean {
  return DUAL.test(label) && WIDE.test(label)
}

function androidCameraId(label: string): number {
  const match = ANDROID_CAMERA_ID.exec(label)
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY
}

// iOS virtual devices, best first. Dual Wide (wide + ultra-wide) is exactly
// the close-focus pair and exists on every multi-lens iPhone since the 11;
// Triple adds the telephoto, which scanning never wants.
const VIRTUAL_MULTI_LENS: ((label: string) => boolean)[] = [
  isDualWide,
  (label) => TRIPLE.test(label),
  (label) => DUAL.test(label),
]

// Returns the device id to open, or null to leave the choice to the browser's
// `facingMode: 'environment'` (labels unreadable before camera permission, or
// no back camera recognized by its label).
export function chooseScanCamera(devices: readonly CameraDevice[]): string | null {
  const labelled = devices.filter((device) => device.label !== '' && device.deviceId !== '')
  const back = labelled.filter((device) => BACK.test(device.label))
  for (const matches of VIRTUAL_MULTI_LENS) {
    const virtual = back.find((device) => matches(device.label))
    if (virtual) return virtual.deviceId
  }
  const plainBack = back.filter((device) => !SPECIAL_LENS.test(device.label))
  // Lowest Android camera id first; the stable sort keeps list order for the
  // rest (labels without an id), where the first plain back camera wins.
  const [main] = [...plainBack].sort((a, b) => androidCameraId(a.label) - androidCameraId(b.label))
  return main?.deviceId ?? null
}
