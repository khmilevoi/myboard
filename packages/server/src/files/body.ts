import type { IncomingMessage } from 'node:http'

import { FileBodyError, FileTooLargeError } from './errors'

/**
 * Buffers a raw upload body up to `limit` bytes. A declared Content-Length over the limit is
 * refused before reading; a body that grows past it stops being buffered at once, and the rest is
 * drained and discarded so the 413 still reaches the client on the same connection.
 */
export function readUploadBody(
  req: IncomingMessage,
  limit: number,
): Promise<Uint8Array | FileTooLargeError | FileBodyError> {
  const tooLarge = () => new FileTooLargeError({ limit: String(limit) })
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) {
    req.resume()
    return Promise.resolve(tooLarge())
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let total = 0
    const stop = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
    }
    function onData(chunk: Buffer) {
      total += chunk.byteLength
      if (total <= limit) {
        chunks.push(chunk)
        return
      }
      stop()
      req.resume()
      resolve(tooLarge())
    }
    function onEnd() {
      stop()
      resolve(new Uint8Array(Buffer.concat(chunks)))
    }
    function onError(cause: Error) {
      stop()
      resolve(new FileBodyError({ cause }))
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}
