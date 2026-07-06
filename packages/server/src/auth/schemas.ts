import { z } from 'zod'

export const RegisterOptionsBodySchema = z.object({
  token: z.string().min(1),
})
export type RegisterOptionsBody = z.infer<typeof RegisterOptionsBodySchema>

// WebAuthn ceremony responses carry many more fields (rawId, response, type, ...);
// we only need to require `id` here (the field handlers dereference before
// consuming the challenge / calling the verifier) while passing the full object
// through to verifyRegistration/verifyAuthentication unchanged.
export const WebAuthnResponseSchema = z.looseObject({
  id: z.string().min(1),
})

export const RegisterVerifyBodySchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(40),
  attestationResponse: WebAuthnResponseSchema,
})
export type RegisterVerifyBody = z.infer<typeof RegisterVerifyBodySchema>

export const LoginOptionsBodySchema = z.object({
  credentialIdHint: z.string().optional(),
})
export type LoginOptionsBody = z.infer<typeof LoginOptionsBodySchema>

export const LoginVerifyBodySchema = z.object({
  authenticationResponse: WebAuthnResponseSchema,
})
export type LoginVerifyBody = z.infer<typeof LoginVerifyBodySchema>

export const AddDeviceRegisterOptionsBodySchema = z.object({ token: z.string().min(1) })
export type AddDeviceRegisterOptionsBody = z.infer<typeof AddDeviceRegisterOptionsBodySchema>

export const AddDeviceRegisterVerifyBodySchema = z.object({
  token: z.string().min(1),
  attestationResponse: WebAuthnResponseSchema,
})
export type AddDeviceRegisterVerifyBody = z.infer<typeof AddDeviceRegisterVerifyBodySchema>

export const AddTokenVerifyBodySchema = z.object({
  authenticationResponse: WebAuthnResponseSchema,
})
export type AddTokenVerifyBody = z.infer<typeof AddTokenVerifyBodySchema>

export const DeviceIdParamsSchema = z.object({ credentialId: z.string().min(1) })
export type DeviceIdParams = z.infer<typeof DeviceIdParamsSchema>
