/**
 * Account tones are hashed from the account id, deliberately NOT taken from the
 * duty rotation: accounts and duty people are independent axes and there may be
 * more accounts than roster slots.
 */
export const MEMBER_TONES = ['1', '2', '3', '4', '5', '6'] as const

export type MemberTone = (typeof MEMBER_TONES)[number]

export function memberTone(accountId: string): MemberTone {
  let hash = 0
  for (let index = 0; index < accountId.length; index++) {
    hash = (hash * 31 + accountId.charCodeAt(index)) >>> 0
  }
  return MEMBER_TONES[hash % MEMBER_TONES.length]
}

export function memberInitial(name: string): string {
  const trimmed = name.trim()
  return trimmed.length === 0 ? '?' : trimmed.slice(0, 1).toUpperCase()
}
