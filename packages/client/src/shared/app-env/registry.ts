export interface AppEnvBranding {
  /** OKLCH hue of the accent. L and C are fixed by the design system, so an
   *  environment's entire palette derives from this one number. */
  hue: number
  /** Suffix in <title> / the PWA manifest name, and the header badge text.
   *  `null` disables branding entirely — that is what makes production a
   *  no-op rather than a special case sprinkled through the codebase. */
  label: string | null
}

/** The design system's fixed accent lightness and chroma; only the hue varies
 *  per environment. */
export const ACCENT_L = 0.55
export const ACCENT_C = 0.17

/**
 * Adding an environment is one entry here plus `pnpm icons:generate`.
 * Changing one is one number.
 */
export const APP_ENVS = {
  production: { hue: 281, label: null },
  dev: { hue: 85, label: 'dev' },
  branch: { hue: 345, label: 'branch' },
  local: { hue: 190, label: 'local' },
} as const satisfies Record<string, AppEnvBranding>

export type AppEnvName = keyof typeof APP_ENVS
