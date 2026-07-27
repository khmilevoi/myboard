import type { Plugin } from 'vite'

import { brandHtml } from '../src/shared/app-env/brand-html'
import type { AppEnvName } from '../src/shared/app-env/registry'

/**
 * Stamps an index.html with its environment: the data-app-env attribute, the
 * title suffix, the derived accent tokens and the per-environment icon paths.
 *
 * Always installed, including for production -- brandHtml is the no-op, not
 * the plugin list, so both configs keep one shape.
 *
 * Default hook order (post) on purpose: Vite injects its own <script> and
 * <link rel="stylesheet"> at the end of <head>, so inserting before </head>
 * puts the accent <style> after the bundled stylesheet. envAccentCss doubles
 * `:root` so correctness does not actually depend on that -- but there is no
 * reason to fight it either.
 */
export function appEnvBranding(name: AppEnvName): Plugin {
  return {
    name: 'app-env-branding',
    transformIndexHtml: (html) => brandHtml(html, name),
  }
}
