import crypto from 'node:crypto'

export function sha256hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function randomId(bytes = 18): string {
  return crypto.randomBytes(bytes).toString('base64url')
}
