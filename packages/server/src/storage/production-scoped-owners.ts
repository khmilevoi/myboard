import { makeScopedOwners, type ScopedOwners } from './scoped'
import { scopedOwnerList } from './scoped-owners.generated'

export const productionScopedOwners: ScopedOwners = makeScopedOwners(scopedOwnerList)
