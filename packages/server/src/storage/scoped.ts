import {
  moduleAccountNamespace,
  moduleSharedNamespace,
  widgetAccountNamespace,
} from '@shared/storage/scope'
import {
  isValidRelativeKey,
  isValidScopedPair,
  type ScopedBranch,
  type ScopedScope,
} from '@shared/storage/scoped'
import * as errore from 'errore'

export type ScopedOwners = {
  widgetTypeIds: ReadonlySet<string>
  moduleScopes: ReadonlyMap<string, readonly ScopedScope[]>
}

export function makeScopedOwners(list: {
  widgetTypeIds: readonly string[]
  moduleScopes: Record<string, readonly ScopedScope[]>
}): ScopedOwners {
  return {
    widgetTypeIds: new Set(list.widgetTypeIds),
    moduleScopes: new Map(Object.entries(list.moduleScopes)),
  }
}

export class ScopedStorageError extends Error {
  status = 500
  code = 'scoped_storage_error'
  publicMessage = 'Scoped storage error'
}

export class ScopedRouteUnknownError extends errore.createTaggedError({
  name: 'ScopedRouteUnknownError',
  message: 'Unknown scoped route $owner/$scope',
  extends: ScopedStorageError,
}) {
  status = 404
  code = 'scoped_route_unknown'
  publicMessage = 'Not found'
}

export class ScopedOwnerUnknownError extends errore.createTaggedError({
  name: 'ScopedOwnerUnknownError',
  message: 'Unknown scoped $owner $id',
  extends: ScopedStorageError,
}) {
  status = 404
  code = 'scoped_owner_unknown'
  publicMessage = 'Not found'
}

export class ScopedScopeUndeclaredError extends errore.createTaggedError({
  name: 'ScopedScopeUndeclaredError',
  message: 'Module $id does not declare scope $scope',
  extends: ScopedStorageError,
}) {
  status = 403
  code = 'scoped_scope_undeclared'
  publicMessage = 'Scope not declared'
}

export class ScopedKeyInvalidError extends errore.createTaggedError({
  name: 'ScopedKeyInvalidError',
  message: 'Invalid scoped storage key',
  extends: ScopedStorageError,
}) {
  status = 422
  code = 'scoped_key_invalid'
  publicMessage = 'Invalid key'
}

export class ScopedSessionRequiredError extends errore.createTaggedError({
  name: 'ScopedSessionRequiredError',
  message: 'A session is required for account-scoped storage',
  extends: ScopedStorageError,
}) {
  status = 401
  code = 'session_missing'
  publicMessage = 'Session required'
}

export function resolveScopedNamespace(options: {
  owners: ScopedOwners
  branch: ScopedBranch
  accountId: string | null
}): ScopedStorageError | string {
  const { owners, branch, accountId } = options
  const { owner, id, scope } = branch
  if (!isValidScopedPair(branch)) return new ScopedRouteUnknownError({ owner, scope })

  if (owner === 'widget' && !owners.widgetTypeIds.has(id)) {
    return new ScopedOwnerUnknownError({ owner, id })
  }
  const declared = owner === 'module' ? owners.moduleScopes.get(id) : undefined
  if (owner === 'module' && declared === undefined)
    return new ScopedOwnerUnknownError({ owner, id })
  if (declared !== undefined && !declared.includes(scope)) {
    return new ScopedScopeUndeclaredError({ id, scope })
  }

  if (scope === 'shared') return moduleSharedNamespace(id)
  if (accountId === null) return new ScopedSessionRequiredError()
  return owner === 'widget'
    ? widgetAccountNamespace(id, accountId)
    : moduleAccountNamespace(id, accountId)
}

export function validateScopedKey(key: string): ScopedKeyInvalidError | string {
  if (!isValidRelativeKey(key)) return new ScopedKeyInvalidError()
  return key
}
