import * as errore from 'errore'

class WidgetDispatchError extends Error {
  status = 500
  code = 'internal_error'
  publicMessage = 'Widget event failed'
}

export class DuplicateWidgetTypeError extends errore.createTaggedError({
  name: 'DuplicateWidgetTypeError',
  message: 'Duplicate widget server type: $typeId',
  extends: WidgetDispatchError,
}) {}

export class UnknownWidgetTypeError extends errore.createTaggedError({
  name: 'UnknownWidgetTypeError',
  message: 'Unknown widget server type: $typeId',
  extends: WidgetDispatchError,
}) {
  status = 404
  code = 'unknown_widget'
  publicMessage = 'Unknown widget type'
}

export class UnknownWidgetEventError extends errore.createTaggedError({
  name: 'UnknownWidgetEventError',
  message: 'Unknown event $event for widget $typeId',
  extends: WidgetDispatchError,
}) {
  status = 404
  code = 'unknown_event'
  publicMessage = 'Unknown widget event'
}

export class InvalidWidgetPayloadError extends errore.createTaggedError({
  name: 'InvalidWidgetPayloadError',
  message: 'Invalid payload for $typeId.$event',
  extends: WidgetDispatchError,
}) {
  status = 422
  code = 'payload_invalid'
  publicMessage = 'Widget event payload is invalid'
}

export class InvalidWidgetResultError extends errore.createTaggedError({
  name: 'InvalidWidgetResultError',
  message: 'Invalid result from $typeId.$event',
  extends: WidgetDispatchError,
}) {}

export class WidgetHandlerError extends errore.createTaggedError({
  name: 'WidgetHandlerError',
  message: 'Handler failed for $typeId.$event',
  extends: WidgetDispatchError,
}) {}

export class WidgetRequestBodyError extends errore.createTaggedError({
  name: 'WidgetRequestBodyError',
  message: 'Widget request body could not be read',
  extends: WidgetDispatchError,
}) {}

export type PublicWidgetDispatchError = WidgetDispatchError
