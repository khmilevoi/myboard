export class JSONParseError extends Error {
  constructor({ cause }: { cause: unknown }) {
    super('Failed to parse JSON', { cause })
    this.name = 'JSONParseError'
  }
}

export function safeParse(raw: string): JSONParseError | unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch (cause) {
    return new JSONParseError({ cause })
  }
}
