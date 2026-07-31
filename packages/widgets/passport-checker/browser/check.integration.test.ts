// @vitest-environment node
import fs from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import type { BrowserTaskContext, WidgetSecrets } from 'browser-automation/task-context'
import { makeDetectUserInput, UserInputRequiredError } from 'browser-automation/user-input'
import { chromium, type BrowserContext } from 'playwright'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { makePassportCheckerBrowser } from '../browser'

const run = process.env.BROWSER_IT === '1'
const fakeSeries = 'АБ'
const fakeNumber = '123456'
const fakePassportNumber = `${fakeSeries}${fakeNumber}`

type FixtureMode =
  | 'success'
  | 'navigation-challenge'
  | 'first-post-challenge'
  | 'second-post-challenge'
  | 'recovery-navigation-failure'
  | 'first-upstream-error'
  | 'second-invalid-json'
  | 'first-invalid-schema'
  | 'first-identity-echo'

function fixtureSecrets(): WidgetSecrets {
  return {
    read: (key) => (key === 'number' ? fakePassportNumber : undefined),
    has: (key) => key === 'number',
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
  let receivedForms: FormData[] = []
  let receivedContentTypes: string[] = []
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
        if (mode === 'recovery-navigation-failure' && receivedForms.length > 0) {
          request.socket.destroy()
          return
        }
        const challenged =
          mode === 'navigation-challenge' ||
          (mode === 'first-post-challenge' && receivedForms.length >= 1) ||
          (mode === 'second-post-challenge' && receivedForms.length >= 2)
        return handleGet(response, challenged)
      }
      if (request.method === 'POST') {
        receivedContentTypes.push(request.headers['content-type'] ?? '')
        const form = await readForm(request)
        receivedForms.push(form)
        return handlePost(response, mode, receivedForms.length)
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
    receivedForms = []
    receivedContentTypes = []
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
    const retain = vi.fn()
    const definition = makePassportCheckerBrowser({ checkerUrl })
    const context: BrowserTaskContext = {
      page,
      secrets: fixtureSecrets(),
      detectUserInput: makeDetectUserInput({ page, recoverySshTarget: null, retain }),
    }
    const result = await definition.handlers.check({}, context)
    if (!retain.mock.calls.length) await page.close()
    return { browserRequests, evaluateSpy, page, result, retain }
  }

  it('submits both exact browser-generated multipart forms in order', async () => {
    const { browserRequests, result } = await runCheck()

    expect(result).toEqual({
      idCard: { kind: 'success', status: 1, send_status_msg: 'ID fixture ok' },
      internationalPassport: {
        kind: 'success',
        status: 2,
        send_status_msg: 'International fixture ok',
      },
    })
    expect(receivedContentTypes).toHaveLength(2)
    expect(receivedContentTypes.every((value) => /^multipart\/form-data; boundary=/.test(value))).toBe(
      true,
    )
    expect(receivedForms.map((form) => Object.fromEntries(form.entries()))).toEqual([
      {
        service: '1',
        doc_1_select: '1',
        doc_1_series: fakeSeries,
        doc_1_number6: fakeNumber,
      },
      {
        service: '2',
        doc_age: '0',
        doc_2_select: '1',
        doc_1_series: fakeSeries,
        doc_1_number6: fakeNumber,
      },
    ])
    expect(requests).toEqual([
      { method: 'GET', url: '/solutions/checker' },
      { method: 'POST', url: '/solutions/checker' },
      { method: 'POST', url: '/solutions/checker' },
    ])
    expect(browserRequests.every((url) => !url.includes('pasport.org.ua'))).toBe(true)
  })

  it('retains a visible navigation challenge without POST', async () => {
    mode = 'navigation-challenge'
    const { page, result, retain } = await runCheck()

    expect(result).toBeInstanceOf(UserInputRequiredError)
    expect(retain).toHaveBeenCalledOnce()
    expect(await page.title()).toContain('Just a moment')
    expect(requests).toEqual([{ method: 'GET', url: '/solutions/checker' }])
    await page.close()
  })

  it('maps a first POST challenge and prepares recovery without repeating POST', async () => {
    mode = 'first-post-challenge'
    const { page, result, retain } = await runCheck()

    expect(result).toBeInstanceOf(UserInputRequiredError)
    expect(retain).toHaveBeenCalledOnce()
    expect(requests).toEqual([
      { method: 'GET', url: '/solutions/checker' },
      { method: 'POST', url: '/solutions/checker' },
      { method: 'GET', url: '/solutions/checker' },
    ])
    expect(await page.title()).toContain('Just a moment')
    await page.close()
  })

  it('maps a second POST challenge, discards the first outcome, and prepares recovery', async () => {
    mode = 'second-post-challenge'
    const { page, result, retain } = await runCheck()

    expect(result).toBeInstanceOf(UserInputRequiredError)
    expect(retain).toHaveBeenCalledOnce()
    expect(requests).toEqual([
      { method: 'GET', url: '/solutions/checker' },
      { method: 'POST', url: '/solutions/checker' },
      { method: 'POST', url: '/solutions/checker' },
      { method: 'GET', url: '/solutions/checker' },
    ])
    expect(await page.title()).toContain('Just a moment')
    await page.close()
  })

  it('continues after the first upstream error and returns the second document result', async () => {
    mode = 'first-upstream-error'

    const { result } = await runCheck()

    expect(result).toEqual({
      idCard: { kind: 'error', code: 'upstream_response' },
      internationalPassport: {
        kind: 'success',
        status: 2,
        send_status_msg: 'International fixture ok',
      },
    })
    expect(requests).toEqual([
      { method: 'GET', url: '/solutions/checker' },
      { method: 'POST', url: '/solutions/checker' },
      { method: 'POST', url: '/solutions/checker' },
    ])
  })

  it('preserves the first document result when the second response has invalid JSON', async () => {
    mode = 'second-invalid-json'

    const { result } = await runCheck()

    expect(result).toEqual({
      idCard: { kind: 'success', status: 1, send_status_msg: 'ID fixture ok' },
      internationalPassport: { kind: 'error', code: 'invalid_checker_response' },
    })
  })

  it.each(['first-invalid-schema', 'first-identity-echo'] as const)(
    'maps %s to a redacted invalid response and continues to the second POST',
    async (fixtureMode) => {
      mode = fixtureMode

      const { result } = await runCheck()

      expect(result).toEqual({
        idCard: { kind: 'error', code: 'invalid_checker_response' },
        internationalPassport: {
          kind: 'success',
          status: 2,
          send_status_msg: 'International fixture ok',
        },
      })
      expect(requests).toEqual([
        { method: 'GET', url: '/solutions/checker' },
        { method: 'POST', url: '/solutions/checker' },
        { method: 'POST', url: '/solutions/checker' },
      ])
      expect(JSON.stringify(result)).not.toContain(fakeSeries)
      expect(JSON.stringify(result)).not.toContain(fakeNumber)
    },
  )

  it('logs a redacted recovery-navigation failure without repeating the POST', async () => {
    mode = 'recovery-navigation-failure'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const { evaluateSpy, page, result, retain } = await runCheck()

    expect(result).toBeInstanceOf(UserInputRequiredError)
    expect(retain).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledOnce()
    expect(JSON.stringify(warn.mock.calls)).not.toContain(fakeSeries)
    expect(JSON.stringify(warn.mock.calls)).not.toContain(fakeNumber)
    // page.evaluate is the transport for both the navigation-evidence probe
    // and the multipart POST. Recovery preparation must only navigate the
    // retained page; it must not submit either document again.
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

function handlePost(response: ServerResponse, mode: FixtureMode, postNumber: number) {
  if (mode === 'first-post-challenge' && postNumber === 1) return challenge(response)
  if (mode === 'second-post-challenge' && postNumber === 2) return challenge(response)
  if (mode === 'recovery-navigation-failure' && postNumber === 1) return challenge(response)
  if (mode === 'first-upstream-error' && postNumber === 1) {
    return response.writeHead(502).end('unavailable')
  }
  if (mode === 'second-invalid-json' && postNumber === 2) {
    return response.writeHead(200, { 'content-type': 'application/json' }).end('{broken')
  }
  if (mode === 'first-invalid-schema' && postNumber === 1) {
    return response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ status: 'wrong', send_status_msg: 'bad' }))
  }
  if (mode === 'first-identity-echo' && postNumber === 1) {
    return response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ status: 1, send_status_msg: `echo ${fakeSeries}${fakeNumber}` }))
  }

  const data =
    postNumber === 1
      ? { status: 1, send_status_msg: 'ID fixture ok', ignored: true }
      : { status: 2, send_status_msg: 'International fixture ok', ignored: true }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(data))
}
