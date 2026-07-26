import { makeRecoveryTransport, RecoveryIssueError } from './recovery-transport'

function fakeResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

async function issueWith(response: Response | 'reject') {
  const fetchFn = vi.fn(async () => {
    if (response === 'reject') throw new Error('offline')
    return response
  })
  const transport = makeRecoveryTransport(fetchFn as unknown as typeof fetch)
  const result = await transport.issue('passport-checker')
  return { result, fetchFn }
}

describe('makeRecoveryTransport', () => {
  it('POSTs same-origin with the CSRF header and parses expiresInMs', async () => {
    const { result, fetchFn } = await issueWith(fakeResponse(200, { expiresInMs: 60_000 }))

    expect(result).toEqual({ expiresInMs: 60_000 })
    expect(fetchFn).toHaveBeenCalledWith('/api/browser/recovery/passport-checker', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'MyBoard' },
    })
  })

  it.each([
    [404, 'recovery_unavailable'],
    [409, 'recovery_busy'],
    [503, 'automation_unavailable'],
    [418, 'invalid_response'],
  ])('maps HTTP %s to %s', async (status, code) => {
    const { result } = await issueWith(fakeResponse(status, { code }))

    expect(result).toBeInstanceOf(RecoveryIssueError)
    if (!(result instanceof RecoveryIssueError)) throw new Error('expected RecoveryIssueError')
    expect(result.code).toBe(code)
  })

  it('maps a network failure to the network code', async () => {
    const { result } = await issueWith('reject')

    expect(result).toBeInstanceOf(RecoveryIssueError)
    if (!(result instanceof RecoveryIssueError)) throw new Error('expected RecoveryIssueError')
    expect(result.code).toBe('network')
  })

  it('maps an unparseable success body to invalid_response', async () => {
    const { result } = await issueWith(fakeResponse(200, { nonsense: true }))

    expect(result).toBeInstanceOf(RecoveryIssueError)
    if (!(result instanceof RecoveryIssueError)) throw new Error('expected RecoveryIssueError')
    expect(result.code).toBe('invalid_response')
  })
})
