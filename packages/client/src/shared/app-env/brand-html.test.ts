import { describe, expect, it } from 'vitest'

import { brandHtml } from './brand-html'

const BOARD_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="apple-mobile-web-app-title" content="myboard" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="icon" href="/favicon.ico" sizes="32x32" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>myboard</title>
  </head>
  <body><div id="root"></div></body>
</html>
`

const ACTIVATION_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>myboard — активация</title>
  </head>
  <body><div id="root"></div></body>
</html>
`

describe('brandHtml', () => {
  it('returns production HTML byte-identical', () => {
    expect(brandHtml(BOARD_HTML, 'production')).toBe(BOARD_HTML)
    expect(brandHtml(ACTIVATION_HTML, 'production')).toBe(ACTIVATION_HTML)
  })

  it('stamps data-app-env on <html> without disturbing lang', () => {
    expect(brandHtml(BOARD_HTML, 'dev')).toContain('<html lang="en" data-app-env="dev">')
    expect(brandHtml(ACTIVATION_HTML, 'branch')).toContain('<html lang="ru" data-app-env="branch">')
  })

  it('suffixes the title', () => {
    expect(brandHtml(BOARD_HTML, 'dev')).toContain('<title>myboard · dev</title>')
    expect(brandHtml(ACTIVATION_HTML, 'local')).toContain(
      '<title>myboard — активация · local</title>',
    )
  })

  it('repoints every icon link and leaves other links alone', () => {
    const html = brandHtml(BOARD_HTML, 'dev')

    expect(html).toContain('href="/env/dev/apple-touch-icon.png"')
    expect(html).toContain('href="/env/dev/favicon.ico"')
    expect(html).toContain('href="/env/dev/favicon.svg"')
    expect(html).not.toContain('href="/favicon')
    expect(html).not.toContain('href="/apple-touch-icon.png"')
    // The rel/type/sizes attributes must survive untouched.
    expect(html).toContain('<link rel="icon" href="/env/dev/favicon.ico" sizes="32x32" />')
  })

  it('does not touch the stylesheet link Vite injects', () => {
    const withCss = BOARD_HTML.replace(
      '</head>',
      '  <link rel="stylesheet" crossorigin href="/assets/index-abc.css">\n</head>',
    )
    expect(brandHtml(withCss, 'dev')).toContain('href="/assets/index-abc.css"')
  })

  it('injects the accent rule sets before </head>', () => {
    const html = brandHtml(BOARD_HTML, 'dev')
    const style = html.indexOf("<style>\n:root:root[data-app-env='dev']")

    expect(style).toBeGreaterThan(-1)
    expect(style).toBeLessThan(html.indexOf('</head>'))
    expect(html).toContain('--primary: oklch(0.55 0.17 85)')
  })

  it('leaves apple-mobile-web-app-title as myboard', () => {
    // short_name and the iOS home-screen title are truncated aggressively;
    // the icon colour already tells the installed apps apart.
    expect(brandHtml(BOARD_HTML, 'dev')).toContain(
      '<meta name="apple-mobile-web-app-title" content="myboard" />',
    )
  })
})
