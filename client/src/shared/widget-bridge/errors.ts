import * as errore from 'errore'

export class BridgeError extends errore.createTaggedError({
  name: 'BridgeError',
  message: 'Bridge protocol error: $reason',
}) {}

export class WidgetLoadError extends errore.createTaggedError({
  name: 'WidgetLoadError',
  message: 'Widget $instanceId failed to load',
}) {}

export class HandshakeTimeoutError extends errore.createTaggedError({
  name: 'HandshakeTimeoutError',
  message: 'Widget $instanceId did not handshake within $timeoutMs ms',
}) {}
