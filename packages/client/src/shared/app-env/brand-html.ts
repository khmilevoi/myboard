import { envIconPath, envTitle } from './icons'
import { APP_ENVS, type AppEnvName } from './registry'
import { envAccentCss } from './tokens'

const HTML_TAG = /<html\b([^>]*)>/i
const TITLE_TAG = /<title>([\s\S]*?)<\/title>/i
const ICON_LINK = /<link\b[^>]*\brel="[^"]*icon[^"]*"[^>]*>/gi
const ROOT_HREF = /href="\/([^"]+)"/i

/**
 * Brand an index.html at build time.
 *
 * Pure string work so it is unit-testable without running a Vite build; the
 * plugin in packages/client/vite/app-env-branding.ts is only the adapter.
 * Production returns the input unchanged, so a production build's HTML is
 * byte-identical to today's.
 *
 * data-app-env goes on <html> statically rather than being set by JS, so the
 * accent is already correct at first paint -- the same reason initTheme()
 * applies the theme synchronously.
 */
export function brandHtml(html: string, name: AppEnvName): string {
  if (APP_ENVS[name].label === null) return html

  let out = html.replace(HTML_TAG, (_tag, attrs: string) => `<html${attrs} data-app-env="${name}">`)

  out = out.replace(
    TITLE_TAG,
    (_tag, title: string) => `<title>${envTitle(title.trim(), name)}</title>`,
  )

  // Matches rel="icon" and rel="apple-touch-icon" alike. Only root-absolute
  // hrefs are rewritten, so Vite's own injected /assets/* links -- which carry
  // rel="stylesheet" and never match ICON_LINK anyway -- stay untouched.
  out = out.replace(ICON_LINK, (tag) =>
    tag.replace(ROOT_HREF, (_href, file: string) => `href="${envIconPath(name, file)}"`),
  )

  return out.replace('</head>', `  <style>\n${envAccentCss(name)}\n</style>\n</head>`)
}
