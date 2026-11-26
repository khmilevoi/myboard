import * as errore from 'errore'

import { WidgetDispatchError } from '../widgets/errors'

export class DuplicateModuleError extends errore.createTaggedError({
  name: 'DuplicateModuleError',
  message: 'Duplicate module server: $moduleId',
  extends: WidgetDispatchError,
}) {}

/** Crons run without a viewer, so they can only reach the shared scope. */
export class ModuleCronWithoutSharedScopeError extends errore.createTaggedError({
  name: 'ModuleCronWithoutSharedScopeError',
  message: 'Module $moduleId declares crons but not the shared scope',
  extends: WidgetDispatchError,
}) {}

export class UnknownModuleError extends errore.createTaggedError({
  name: 'UnknownModuleError',
  message: 'Unknown module: $moduleId',
  extends: WidgetDispatchError,
}) {
  status = 404
  code = 'unknown_module'
  publicMessage = 'Unknown module'
}

export class UnknownModuleActionError extends errore.createTaggedError({
  name: 'UnknownModuleActionError',
  message: 'Unknown action $action for module $moduleId',
  extends: WidgetDispatchError,
}) {
  status = 404
  code = 'unknown_action'
  publicMessage = 'Unknown module action'
}

export class InvalidModulePayloadError extends errore.createTaggedError({
  name: 'InvalidModulePayloadError',
  message: 'Invalid payload for $moduleId.$action',
  extends: WidgetDispatchError,
}) {
  status = 422
  code = 'payload_invalid'
  publicMessage = 'Module action payload is invalid'
}

export class ModuleAccountRequiredError extends errore.createTaggedError({
  name: 'ModuleAccountRequiredError',
  message: 'Module $moduleId action $action needs a signed-in account',
  extends: WidgetDispatchError,
}) {
  status = 401
  code = 'account_required'
  publicMessage = 'Sign-in required'
}

export class ModuleHandlerError extends errore.createTaggedError({
  name: 'ModuleHandlerError',
  message: 'Handler failed for $moduleId.$action',
  extends: WidgetDispatchError,
}) {}

export class InvalidModuleResultError extends errore.createTaggedError({
  name: 'InvalidModuleResultError',
  message: 'Invalid result from $moduleId.$action',
  extends: WidgetDispatchError,
}) {}
