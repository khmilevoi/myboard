import { CAT_AVATAR_SLOT_PATTERN } from '@modules/cats/domain/keys'
import { AVATAR_POLICY } from '@shared/files/contract'

import { makeFilePolicies, type FilePolicies } from '../files/policies'

/**
 * The file slots production accepts. Deny by default: a slot not declared here answers 403.
 *
 * Declared by hand for now: the cats module's per-cat avatar slot. When more slots exist, their
 * policies should be declared next to their server definition and collected by codegen, the way
 * `scoped-owners.generated` collects scoped owners, rather than listed here.
 */
export const productionFilePolicies: FilePolicies = makeFilePolicies([
  {
    owner: 'module',
    id: 'cats',
    scope: 'shared',
    keyPattern: CAT_AVATAR_SLOT_PATTERN,
    policy: AVATAR_POLICY,
  },
])
