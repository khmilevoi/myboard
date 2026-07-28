import { APP_ENVS, type AppEnvName } from './registry'

/**
 * Every icon file a branded environment ships, mirroring the production set in
 * packages/client/public/. The generator writes exactly this list into
 * public/env/<name>/ and icons-lock.test.ts asserts every one of them exists.
 */
export const ENV_ICON_FILES = [
  'favicon.svg',
  'favicon.ico',
  'apple-touch-icon.png',
  'pwa-icon.svg',
  'pwa-icon.png',
  'pwa-icon-192.png',
  'pwa-icon-maskable.svg',
  'pwa-icon-maskable.png',
] as const

/** Production keeps the root paths untouched; branded environments get a directory. */
export function envIconPath(name: AppEnvName, file: string): string {
  return APP_ENVS[name].label === null ? `/${file}` : `/env/${name}/${file}`
}

/**
 * Suffix for <title> and the PWA manifest name. The default separator is the
 * document-title one (`myboard · dev`); the manifest passes ' ' because a
 * home-screen name reads better as `myboard dev`.
 */
export function envTitle(base: string, name: AppEnvName, separator = ' · '): string {
  const { label } = APP_ENVS[name]
  return label === null ? base : `${base}${separator}${label}`
}
