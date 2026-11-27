import * as errore from 'errore'

export class HardwareError extends Error {
  status = 500
  code = 'internal_error'
  publicMessage = 'Hardware request failed'
}

export class GatewayCodeInvalidError extends errore.createTaggedError({
  name: 'GatewayCodeInvalidError',
  message: 'Registration code is invalid or expired',
  extends: HardwareError,
}) {
  status = 400
  code = 'gateway_code_invalid'
  publicMessage = 'Registration code is invalid or expired'
}

export class GatewayUnauthorizedError extends errore.createTaggedError({
  name: 'GatewayUnauthorizedError',
  message: 'Gateway is not authorized',
  extends: HardwareError,
}) {
  status = 401
  code = 'gateway_unauthorized'
  publicMessage = 'Gateway is not authorized'
}

export class GatewayNotFoundError extends errore.createTaggedError({
  name: 'GatewayNotFoundError',
  message: 'Gateway not found',
  extends: HardwareError,
}) {
  status = 404
  code = 'gateway_not_found'
  publicMessage = 'Gateway not found'
}

export class GatewayOfflineError extends errore.createTaggedError({
  name: 'GatewayOfflineError',
  message: 'Gateway is offline',
  extends: HardwareError,
}) {
  status = 409
  code = 'gateway_offline'
  publicMessage = 'Gateway is offline'
}

export class HardwareNotFoundError extends errore.createTaggedError({
  name: 'HardwareNotFoundError',
  message: 'Hardware not found',
  extends: HardwareError,
}) {
  status = 404
  code = 'hardware_not_found'
  publicMessage = 'Hardware not found'
}

export class HardwareExistsError extends errore.createTaggedError({
  name: 'HardwareExistsError',
  message: 'Hardware is already registered',
  extends: HardwareError,
}) {
  status = 409
  code = 'hardware_exists'
  publicMessage = 'Hardware is already registered'
}

export class ScanResultUnknownError extends errore.createTaggedError({
  name: 'ScanResultUnknownError',
  message: 'No such scan result',
  extends: HardwareError,
}) {
  status = 404
  code = 'scan_result_unknown'
  publicMessage = 'No such scan result'
}

export class BondUnknownError extends errore.createTaggedError({
  name: 'BondUnknownError',
  message: 'No such bonded hardware',
  extends: HardwareError,
}) {
  status = 404
  code = 'bond_unknown'
  publicMessage = 'No such bonded hardware'
}

export class PairingNotFoundError extends errore.createTaggedError({
  name: 'PairingNotFoundError',
  message: 'Pairing not found',
  extends: HardwareError,
}) {
  status = 404
  code = 'pairing_not_found'
  publicMessage = 'Pairing not found'
}

export class PairingNotWaitingPinError extends errore.createTaggedError({
  name: 'PairingNotWaitingPinError',
  message: 'Pairing is not waiting for a PIN',
  extends: HardwareError,
}) {
  status = 409
  code = 'pairing_not_waiting_pin'
  publicMessage = 'Pairing is not waiting for a PIN'
}

export class HealthProfileMissingError extends errore.createTaggedError({
  name: 'HealthProfileMissingError',
  message: 'Health profile is missing',
  extends: HardwareError,
}) {
  status = 409
  code = 'health_profile_missing'
  publicMessage = 'Health profile is missing'
}

export class ScaleProfileBoundError extends errore.createTaggedError({
  name: 'ScaleProfileBoundError',
  message: 'Scale profile is already bound',
  extends: HardwareError,
}) {
  status = 409
  code = 'scale_profile_bound'
  publicMessage = 'Scale profile is already bound'
}

export class ScaleProfileUnknownError extends errore.createTaggedError({
  name: 'ScaleProfileUnknownError',
  message: 'No such scale profile',
  extends: HardwareError,
}) {
  status = 404
  code = 'scale_profile_unknown'
  publicMessage = 'No such scale profile'
}

export class BindingNotFoundError extends errore.createTaggedError({
  name: 'BindingNotFoundError',
  message: 'Binding not found',
  extends: HardwareError,
}) {
  status = 404
  code = 'binding_not_found'
  publicMessage = 'Binding not found'
}

export class NotBindingOwnerError extends errore.createTaggedError({
  name: 'NotBindingOwnerError',
  message: 'Only the binding owner can do this',
  extends: HardwareError,
}) {
  status = 403
  code = 'not_binding_owner'
  publicMessage = 'Only the binding owner can do this'
}
