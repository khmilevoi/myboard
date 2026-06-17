import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { readJsonBody } from './body'

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    const req = Readable.from([Buffer.from(JSON.stringify({ value: 1 }))])
    expect(await readJsonBody(req as never)).toEqual({ value: 1 })
  })

  it('returns undefined for an empty body', async () => {
    const req = Readable.from([])
    expect(await readJsonBody(req as never)).toBeUndefined()
  })

  it('throws on invalid JSON', async () => {
    const req = Readable.from([Buffer.from('not json')])
    await expect(readJsonBody(req as never)).rejects.toThrow()
  })

  it('throws when body exceeds the size limit', async () => {
    const big = Buffer.alloc(1_048_577, 'x')
    const req = Readable.from([big])
    await expect(readJsonBody(req as never)).rejects.toThrow('request body too large')
  })
})
