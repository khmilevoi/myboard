export type ScopedOwner = 'widget' | 'module'
export type ScopedScope = 'shared' | 'account'
export type ScopedBranch = { owner: ScopedOwner; id: string; scope: ScopedScope }
export type ScopedStorageRef = ScopedBranch & { key: string }

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

export function scopedEventKey(ref: ScopedStorageRef): string {
  return `scoped:${ref.owner}/${ref.id}/${ref.scope}/${ref.key}`
}
