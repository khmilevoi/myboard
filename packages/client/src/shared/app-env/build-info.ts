/**
 * Which source a stand's bundle was built from: the branch and the commit.
 *
 * Both are optional on purpose. rpi injects RPI_BRANCH_NAME and RPI_COMMIT_SHA
 * only for deploys through an agent >= 0.27, a local `pnpm dev` has neither,
 * and production never shows them -- so "unknown" is a normal state the badge
 * renders around, not an error worth failing a build over.
 */
export interface AppBuildInfo {
  branch: string | null
  /** Short SHA, {@link SHORT_SHA_LENGTH} characters. */
  commit: string | null
}

export const SHORT_SHA_LENGTH = 7

const SHA = /^[0-9a-f]{7,40}$/i

/**
 * Normalises the raw build-time values. Blank -> null. A commit that is not a
 * hex SHA is dropped rather than shown: the field is a quick "which build is
 * this" check, and a garbled value would answer it wrongly.
 */
export function resolveBuildInfo(
  rawBranch: string | undefined,
  rawCommit: string | undefined,
): AppBuildInfo {
  const branch = rawBranch?.trim() || null
  const commit = rawCommit?.trim() ?? ''

  return {
    branch,
    commit: SHA.test(commit) ? commit.slice(0, SHORT_SHA_LENGTH).toLowerCase() : null,
  }
}
