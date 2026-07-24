import fs from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import type { BrowserTaskContext, WidgetSecrets } from 'browser-automation/task-context'
import { chromium, type BrowserContext } from 'playwright'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { makePassportCheckerBrowser } from '../browser'
import {
  BrowserSessionRequiredError,
  InvalidCheckerResponseError,
  UpstreamResponseError,
} from './errors'

const run = process.env.BROWSER_IT === '1'
const fakeSeries = 'АБ'
const fakeNumber = '123456'

type FixtureMode =
  | 'success'
  | 'navigation-challenge'
  | 'post-challenge'
  | 'recovery-navigation-failure'
  | 'upstream-error'
  | 'invalid-json'
  | 'invalid-schema'

function fixtureSecrets(): WidgetSecrets {
  return {
    read: (key) => (key === 'series' ? fakeSeries : key === 'number' ? fakeNumber : undefined),
    has: (key) => key === 'series' || key === 'number',
  }
}

async function readForm(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const response = new Response(new Uint8Array(Buffer.concat(chunks)), {
    headers: { 'content-type': request.headers['content-type'] ?? '' },
  })
  return response.formData()
}

describe.skipIf(!run)('passport checker (real browser fixture)', () => {
  let browser: BrowserContext
  let server: http.Server
  let checkerUrl = ''
  let profileDir = ''
  let mode: FixtureMode = 'success'
  let receivedForm: FormData | null = null
  let receivedContentType = ''
  const requests: Array<{ method: string; url: string }> = []

  beforeAll(async () => {
    server = http.createServer(async (request, response) => {
      // Headed Chromium auto-requests /favicon.ico on navigation; this is a
      // real-browser artifact unrelated to the checker flow under test, so it
      // is answered directly and kept out of the tracked request sequence.
      if (request.url === '/favicon.ico') {
        response.writeHead(404).end()
        return
      }
      requests.push({ method: request.method ?? '', url: request.url ?? '' })
      if (request.method === 'GET') {
        // The post-challenge recovery navigation: kill the connection instead
        // of responding, so the browser's goto() rejects at the network level
        // (mirrors a real dropped connection during recovery).
        if (mode === 'recovery-navigation-failure' && receivedForm !== null) {
          request.socket.destroy()
          return
        }
        const challenged =
          mode === 'navigation-challenge' ||
          ((mode === 'post-challenge' || mode === 'recovery-navigation-failure') &&
            receivedForm !== null)
        return handleGet(response, challenged)
      }
      if (request.method === 'POST') {
        receivedContentType = request.headers['content-type'] ?? ''
        receivedForm = await readForm(request)
        return handlePost(response, mode)
      }
      response.writeHead(405).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    checkerUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/solutions/checker`
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'passport-checker-it-profile-'))
    browser = await chromium.launchPersistentContext(profileDir, { headless: false })
  })

  beforeEach(() => {
    mode = 'success'
    receivedForm = null
    receivedContentType = ''
    requests.length = 0
  })

  afterAll(async () => {
    await browser?.close()
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    if (profileDir) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true })
      } catch {
        // Chromium or the OS may still hold a brief lock on profile files
        // right after context.close(), especially on Windows; a leaked temp
        // dir here is a nuisance, not a test failure.
      }
    }
  })

  async function runCheck() {
    const page = await browser.newPage()
    const browserRequests: string[] = []
    page.on('request', (request) => browserRequests.push(request.url()))
    const evaluateSpy = vi.spyOn(page, 'evaluate')
    const retainPageForRecovery = vi.fn()
    const definition = makePassportCheckerBrowser({ checkerUrl, recoverySshTarget: null })
    const context: BrowserTaskContext = {
      page,
      secrets: fixtureSecrets(),
      retainPageForRecovery,
    }
    const result = await definition.handlers.check({}, context)
    if (!retainPageForRecovery.mock.calls.length) await page.close()
    return { browserRequests, evaluateSpy, page, result, retainPageForRecovery }
  }

  it('submits exact browser-generated multipart fields and returns validated data', async () => {
    const { browserRequests, result } = await runCheck()

    expect(result).toEqual({ status: 1, send_status_msg: 'fixture ok' })
    expect(receivedContentType).toMatch(/^multipart\/form-data; boundary=/)
    expect(receivedForm).not.toBeNull()
    expect(Object.fromEntries(receivedForm!.entries())).toEqual({
      service: '1',
      doc_1_select: '1',
      doc_1_series: fakeSeries,
      doc_1_number6: fakeNumber,
    })
    expect(requests).toEqual([
      { method: 'GET', url: '/solutions/checker' },
      { method: 'POST', url: '/solutions/checker' },
    ])
    expect(browserRequests.every((url) => !url.includes('pasport.org.ua'))).toBe(true)
  })

  it('retains a visible navigation challenge without POST', async () => {
    mode = 'navigation-challenge'
    const { page, result, retainPageForRecovery } = await runCheck()

    expect(result).toBeInstanceOf(BrowserSessionRequiredError)
    expect(retainPageForRecovery).toHaveBeenCalledOnce()
    expect(await page.title()).toContain('Just a moment')
    expect(requests).toEqual([{ method: 'GET', url: '/solutions/checker' }])
    await page.close()
  })

  it('maps a POST challenge and prepares recovery without repeating POST', async () => {
    mode = 'post-challenge'
    const { page, result, retainPageForRecovery } = await runCheck()

    expect(result).toBeInstanceOf(BrowserSessionRequiredError)
    expect(retainPageForRecovery).toHaveBeenCalledOnce()
    expect(requests).toEqual([
      { method: 'GET', url: '/solutions/checker' },
      { method: 'POST', url: '/solutions/checker' },
      { method: 'GET', url: '/solutions/checker' },
    ])
    expect(await page.title()).toContain('Just a moment')
    await page.close()
  })

  it.each([
    ['upstream-error', UpstreamResponseError],
    ['invalid-json', InvalidCheckerResponseError],
    ['invalid-schema', InvalidCheckerResponseError],
  ] as const)(
    'maps %s to a typed error whose serialized result omits identity',
    async (fixtureMode, ErrorType) => {
      mode = fixtureMode

      const { result } = await runCheck()

      expect(result).toBeInstanceOf(ErrorType)
      expect(JSON.stringify(result)).not.toContain(fakeSeries)
      expect(JSON.stringify(result)).not.toContain(fakeNumber)
    },
  )

  it('logs a redacted recovery-navigation failure without repeating the POST', async () => {
    mode = 'recovery-navigation-failure'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const { evaluateSpy, page, result, retainPageForRecovery } = await runCheck()

    expect(result).toBeInstanceOf(BrowserSessionRequiredError)
    expect(retainPageForRecovery).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledOnce()
    expect(JSON.stringify(warn.mock.calls)).not.toContain(fakeSeries)
    expect(JSON.stringify(warn.mock.calls)).not.toContain(fakeNumber)
    // page.evaluate is the transport for both the navigation-evidence probe
    // and the multipart POST; a connection-reset retry by Chromium repeats
    // the raw GET at the socket level (untracked here), but it never routes
    // back through evaluate, so this count staying at 2 is what proves the
    // POST itself was not repeated.
    expect(evaluateSpy).toHaveBeenCalledTimes(2)
    expect(requests.filter((request) => request.method === 'POST')).toEqual([
      { method: 'POST', url: '/solutions/checker' },
    ])

    warn.mockRestore()
    await page.close()
  })
})

function challenge(response: ServerResponse) {
  response.writeHead(503, {
    'content-type': 'text/html',
    server: 'cloudflare',
    'cf-ray': 'fixture-ray',
  })
  response.end('<!doctype html><title>Just a moment...</title><form id="challenge-form"></form>')
}

function handleGet(response: ServerResponse, challenged: boolean) {
  if (challenged) return challenge(response)
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end('<!doctype html><title>Checker fixture</title><main>ready</main>')
}

function handlePost(response: ServerResponse, mode: FixtureMode) {
  if (mode === 'post-challenge' || mode === 'recovery-navigation-failure') {
    return challenge(response)
  }
  if (mode === 'upstream-error') return response.writeHead(502).end('unavailable')
  if (mode === 'invalid-json') {
    return response.writeHead(200, { 'content-type': 'application/json' }).end('{broken')
  }
  if (mode === 'invalid-schema') {
    return response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ status: 'wrong', send_status_msg: 'bad' }))
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ status: 1, send_status_msg: 'fixture ok', ignored: true }))
}
