import { ACCENT_C, ACCENT_L, APP_ENVS, type AppEnvName } from './registry'

/**
 * The environment palette as two CSS rule sets, ready to inject into <head>.
 *
 * `:root:root` is deliberate, not a typo. tokens.css writes its light block as
 * `:root, :root[data-theme='light']`; once initTheme() stamps data-theme, that
 * selector has specificity (0,2,0) -- identical to a single
 * `:root[data-app-env='dev']`. A tie is broken by source order, and the
 * position of a transformIndexHtml-injected <style> relative to Vite's own
 * bundled stylesheet link is not something to depend on. Doubling the
 * pseudo-class makes the light override (0,3,0) and the dark one (0,4,0),
 * which outrank tokens.css whatever the order turns out to be.
 *
 * --primary-hover is not in tokens.css. The board's own global.css derives it
 * from --primary with color-mix, so it follows for free there, but the
 * activation app hardcodes a purple -- and the activation screen is the first
 * page a device sees on a stand, so it has to be branded too.
 */
export function envAccentCss(name: AppEnvName): string {
  const { hue, label } = APP_ENVS[name]
  if (label === null) return ''

  const root = `:root:root[data-app-env='${name}']`

  return [
    `${root} {`,
    `  --primary: oklch(${ACCENT_L} ${ACCENT_C} ${hue});`,
    `  --primary-hover: oklch(0.49 0.17 ${hue});`,
    `  --ring: oklch(${ACCENT_L} ${ACCENT_C} ${hue});`,
    `  --accent-soft: oklch(0.955 0.032 ${hue});`,
    `  --env-badge-fg: oklch(0.5 0.15 ${hue});`,
    `}`,
    `${root}[data-theme='dark'] {`,
    `  --primary: oklch(0.675 0.155 ${hue});`,
    `  --primary-hover: oklch(0.73 0.155 ${hue});`,
    `  --ring: oklch(0.675 0.155 ${hue});`,
    `  --accent-soft: oklch(0.315 0.06 ${hue});`,
    `  --env-badge-fg: oklch(0.675 0.155 ${hue});`,
    `}`,
  ].join('\n')
}
