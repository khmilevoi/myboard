import type { FilePolicy } from '@shared/files/contract'
import type { ScopedBranch, ScopedOwner, ScopedScope } from '@shared/storage/scoped'

/**
 * One declared file slot family. `keyPattern` is a RegExp tested against the slot key, or a
 * string the slot key must start with (`''` covers every key of the branch).
 */
export type FilePolicyDeclaration = {
  owner: ScopedOwner
  id: string
  scope: ScopedScope
  keyPattern: RegExp | string
  policy: FilePolicy
}

/** Deny by default: a slot without a declared policy cannot hold files (403). */
export type FilePolicies = {
  resolve(branch: ScopedBranch, key: string): FilePolicy | null
}

function matchesKey(pattern: RegExp | string, key: string): boolean {
  return typeof pattern === 'string' ? key.startsWith(pattern) : pattern.test(key)
}

/** The first declaration matching the branch and key wins. */
export function makeFilePolicies(declarations: readonly FilePolicyDeclaration[]): FilePolicies {
  return {
    resolve(branch, key) {
      const found = declarations.find(
        (d) =>
          d.owner === branch.owner &&
          d.id === branch.id &&
          d.scope === branch.scope &&
          matchesKey(d.keyPattern, key),
      )
      return found?.policy ?? null
    },
  }
}
