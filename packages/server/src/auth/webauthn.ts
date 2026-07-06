import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers'

import type { AuthConfig } from './config'
import { WebAuthnVerificationError } from './errors'

// Strict WebAuthn profile (see .superpowers/sdd/constraints.md):
// discoverable, user-verified credentials using ES256 or EdDSA, no attestation.
const SUPPORTED_ALGORITHM_IDS = [-7, -8]

export type CredentialDescriptor = {
  id: string
  transports?: AuthenticatorTransportFuture[]
}

export type VerifiedRegistration = {
  credentialId: string
  publicKey: string
  signCount: number
  transports?: AuthenticatorTransportFuture[]
}

export type VerifyRegistrationDevice = {
  credentialId: string
  publicKey: string
  signCount: number
  transports?: AuthenticatorTransportFuture[]
}

export async function buildRegistrationOptions(
  config: AuthConfig,
  params: {
    userId: string
    userName: string
    userDisplayName: string
    excludeCredentials?: CredentialDescriptor[]
  },
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userID: isoUint8Array.fromUTF8String(params.userId),
    userName: params.userName,
    userDisplayName: params.userDisplayName,
    attestationType: 'none',
    excludeCredentials: params.excludeCredentials,
    authenticatorSelection: {
      userVerification: 'required',
      residentKey: 'required',
    },
    supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
  })
}

export async function verifyRegistration(
  config: AuthConfig,
  params: { response: RegistrationResponseJSON; expectedChallenge: string },
): Promise<VerifiedRegistration | WebAuthnVerificationError> {
  let result: Awaited<ReturnType<typeof verifyRegistrationResponse>>
  try {
    result = await verifyRegistrationResponse({
      response: params.response,
      expectedChallenge: params.expectedChallenge,
      expectedOrigin: config.expectedOrigin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    })
  } catch {
    return new WebAuthnVerificationError()
  }

  if (!result.verified || !result.registrationInfo) return new WebAuthnVerificationError()

  const { credential } = result.registrationInfo
  return {
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    signCount: credential.counter,
    transports: credential.transports,
  }
}

export async function buildAuthenticationOptions(
  config: AuthConfig,
  params: { allowCredentials?: CredentialDescriptor[] },
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: config.rpID,
    userVerification: 'required',
    allowCredentials: params.allowCredentials,
  })
}

export async function verifyAuthentication(
  config: AuthConfig,
  params: {
    response: AuthenticationResponseJSON
    expectedChallenge: string
    device: VerifyRegistrationDevice
  },
): Promise<{ newSignCount: number } | WebAuthnVerificationError> {
  let result: Awaited<ReturnType<typeof verifyAuthenticationResponse>>
  try {
    result = await verifyAuthenticationResponse({
      response: params.response,
      expectedChallenge: params.expectedChallenge,
      expectedOrigin: config.expectedOrigin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
      credential: {
        id: params.device.credentialId,
        publicKey: isoBase64URL.toBuffer(params.device.publicKey),
        counter: params.device.signCount,
        transports: params.device.transports,
      },
    })
  } catch {
    return new WebAuthnVerificationError()
  }

  if (!result.verified) return new WebAuthnVerificationError()

  const newSignCount = result.authenticationInfo.newCounter
  if (params.device.signCount > 0 && newSignCount <= params.device.signCount) {
    return new WebAuthnVerificationError()
  }

  return { newSignCount }
}
