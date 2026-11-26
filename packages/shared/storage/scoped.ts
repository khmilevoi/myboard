export type ScopedOwner = 'widget' | 'module'
export type ScopedScope = 'shared' | 'account'
export type ScopedBranch = { owner: ScopedOwner; id: string; scope: ScopedScope }
export type ScopedStorageRef = ScopedBranch & { key: string }
/** The branches that exist: a widget owns only an account scope; a module may own both. */
export type ValidScopedBranch =
  | { owner: 'widget'; id: string; scope: 'account' }
  | { owner: 'module'; id: string; scope: ScopedScope }

export const RELATIVE_KEY_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/

export function isValidRelativeKey(key: string): boolean {
  return RELATIVE_KEY_PATTERN.test(key) && !key.split('/').includes('..')
}

export function isValidScopedPair(pair: { owner: ScopedOwner; scope: ScopedScope }): boolean {
  return pair.owner === 'module' || pair.scope === 'account'
}

export function scopedBranchPath(branch: ScopedBranch): string {
  return `/scoped/${branch.owner}/${encodeURIComponent(branch.id)}/${branch.scope}`
}

/**
 * Sent by the client with account-scoped requests: the account its UI is showing. It grants
 * nothing — the server still derives the namespace from the session — it only lets the server
 * refuse (409) a request whose session has meanwhile switched to another account, instead of
 * writing the shown account's data into the session account's namespace.
 */
export const EXPECTED_ACCOUNT_HEADER = 'x-myboard-expected-account'

export function scopedEventKey(ref: ScopedStorageRef): string {
  return `scoped:${ref.owner}/${ref.id}/${ref.scope}/${ref.key}`
}
