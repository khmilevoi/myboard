import * as errore from 'errore'

class AuthError extends Error {
  status = 500
  code = 'internal_error'
  publicMessage = 'Authentication failed'
}

export class InviteNotFoundError extends errore.createTaggedError({
  name: 'InviteNotFoundError',
  message: 'Invite not found',
  extends: AuthError,
}) {
  status = 404
  code = 'invite_not_found'
  publicMessage = 'Invite not found'
}

export class InviteExpiredError extends errore.createTaggedError({
  name: 'InviteExpiredError',
  message: 'Invite has expired',
  extends: AuthError,
}) {
  status = 410
  code = 'invite_expired'
  publicMessage = 'This invite has expired'
}

export class InviteConsumedError extends errore.createTaggedError({
  name: 'InviteConsumedError',
  message: 'Invite has already been used',
  extends: AuthError,
}) {
  status = 409
  code = 'invite_consumed'
  publicMessage = 'This invite has already been used'
}

export class InviteLockedError extends errore.createTaggedError({
  name: 'InviteLockedError',
  message: 'Invite is locked after too many failed attempts',
  extends: AuthError,
}) {
  status = 429
  code = 'invite_locked'
  publicMessage = 'Too many failed attempts, try again later'
}

export class ChallengeInvalidError extends errore.createTaggedError({
  name: 'ChallengeInvalidError',
  message: 'Challenge is missing, expired, or already used',
  extends: AuthError,
}) {
  status = 400
  code = 'challenge_invalid'
  publicMessage = 'Challenge is invalid or expired'
}

export class WebAuthnVerificationError extends errore.createTaggedError({
  name: 'WebAuthnVerificationError',
  message: 'WebAuthn ceremony verification failed',
  extends: AuthError,
}) {
  status = 400
  code = 'webauthn_verification_failed'
  publicMessage = 'Passkey verification failed'
}

export class SessionMissingError extends errore.createTaggedError({
  name: 'SessionMissingError',
  message: 'No valid session found',
  extends: AuthError,
}) {
  status = 401
  code = 'session_missing'
  publicMessage = 'Not signed in'
}

export class DeviceNotFoundError extends errore.createTaggedError({
  name: 'DeviceNotFoundError',
  message: 'Device not found',
  extends: AuthError,
}) {
  status = 404
  code = 'device_not_found'
  publicMessage = 'Device not found'
}

export class DeviceDisabledError extends errore.createTaggedError({
  name: 'DeviceDisabledError',
  message: 'Device is disabled',
  extends: AuthError,
}) {
  status = 403
  code = 'device_disabled'
  publicMessage = 'This device has been disabled'
}

export class AddTokenInvalidError extends errore.createTaggedError({
  name: 'AddTokenInvalidError',
  message: 'Add-device token is missing, expired, or already used',
  extends: AuthError,
}) {
  status = 400
  code = 'add_token_invalid'
  publicMessage = 'This add-device link is invalid or expired'
}

export class AccountNotFoundError extends errore.createTaggedError({
  name: 'AccountNotFoundError',
  message: 'Account not found',
  extends: AuthError,
}) {
  status = 404
  code = 'account_not_found'
  publicMessage = 'Account not found'
}

export class DeviceLimitError extends errore.createTaggedError({
  name: 'DeviceLimitError',
  message: 'Account has reached its device limit',
  extends: AuthError,
}) {
  status = 409
  code = 'device_limit'
  publicMessage = 'This account has reached its device limit'
}

export class LastActiveDeviceError extends errore.createTaggedError({
  name: 'LastActiveDeviceError',
  message: 'Cannot remove the last active device on an account',
  extends: AuthError,
}) {
  status = 409
  code = 'last_active_device'
  publicMessage = 'Cannot remove the last active device on this account'
}

export class PendingTicketInvalidError extends errore.createTaggedError({
  name: 'PendingTicketInvalidError',
  message: 'Pending ticket is missing, expired, or already used',
  extends: AuthError,
}) {
  status = 401
  code = 'pending_ticket_invalid'
  publicMessage = 'This pending ticket is invalid or expired'
}

export class NotAuthorizedError extends errore.createTaggedError({
  name: 'NotAuthorizedError',
  message: 'Not authorized to perform this action',
  extends: AuthError,
}) {
  status = 403
  code = 'not_authorized'
  publicMessage = 'You are not authorized to perform this action'
}

export type PublicAuthError = AuthError
