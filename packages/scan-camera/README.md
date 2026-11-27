# scan-camera

Picks and tunes the phone camera a close-range scanner (QR codes, barcodes) opens, so the preview
shows the lens's full field of view and focuses at arm's length, like the system camera app.

```ts
import { resolveScanConstraints, tuneScanTrack } from 'scan-camera'

const constraints = await resolveScanConstraints(navigator.mediaDevices)
if (constraints instanceof Error) return showNoCamera()
const stream = await navigator.mediaDevices.getUserMedia(constraints)
await tuneScanTrack(stream.getVideoTracks()[0])
```

- `resolveScanConstraints` opens the camera once for permission (labels are empty before it), reads
  the camera list and returns constraints for the chosen device. Pass `{ cameraIndex }` to force an
  entry of the list when comparing lenses on a device.
- `chooseScanCamera` is the pure choice: an iOS virtual multi-lens camera (Dual Wide, then Triple,
  then Dual), matched in several languages because iOS translates labels; else the plain back lens,
  skipping ultra-wide, telephoto and depth lenses, lowest Android camera id first.
- `buildScanConstraints` asks for a native 4:3 mode (`resizeMode: 'none'`), so neither the camera
  nor Chrome crops the frame.
- `tuneScanTrack` moves an open track to a native mode of the sensor's own shape, continuous
  autofocus and the widest zoom, as far as the browser allows.

Browsers report no lens type, so all of this reads labels. When a phone picks the wrong lens, open
the app's camera debug readout, note the labels, and extend the word lists in
`src/choose-camera.ts` with a test for that phone.
