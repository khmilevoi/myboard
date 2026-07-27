/**
 * OKLCH -> sRGB hex, via OKLab -> LMS -> linear sRGB -> gamma.
 *
 * The generated icons must carry a plain hex fill: an SVG favicon is decoded
 * by the browser's image pipeline rather than by its CSS engine, and a colour
 * function that pipeline does not understand fails silently to black or
 * transparent. So the same accent has to exist in two forms, and this is the
 * one bridge between them.
 *
 * Out-of-gamut channels are clipped, not gamut-mapped. Every hue in the
 * registry sits well inside sRGB at L 0.55 / C 0.17, so clipping never fires
 * in production use; it exists so a mistyped chroma yields a wrong colour
 * rather than the string "#NaNNaNNaN".
 */
export function oklchToHex(l: number, c: number, h: number): string {
  const hRad = (h * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const b = c * Math.sin(hRad)

  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ] as const

  const linear = [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ]

  return `#${linear.map(toChannelHex).join('')}`
}

function toChannelHex(linear: number): string {
  // Clamp BEFORE the transfer function: `(negative) ** (1 / 2.4)` is NaN.
  const clamped = Math.min(1, Math.max(0, linear))
  const gamma = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
  return Math.round(gamma * 255)
    .toString(16)
    .padStart(2, '0')
}
