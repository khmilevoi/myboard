import { z } from 'zod'

export const RegisterOptionsBodySchema = z.object({
  token: z.string().min(1),
})
export type RegisterOptionsBody = z.infer<typeof RegisterOptionsBodySchema>

export const RegisterVerifyBodySchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(40),
  attestationResponse: z.unknown(),
})
export type RegisterVerifyBody = z.infer<typeof RegisterVerifyBodySchema>

export const LoginOptionsBodySchema = z.object({
  credentialIdHint: z.string().optional(),
})
export type LoginOptionsBody = z.infer<typeof LoginOptionsBodySchema>

export const LoginVerifyBodySchema = z.object({
  authenticationResponse: z.unknown(),
})
export type LoginVerifyBody = z.infer<typeof LoginVerifyBodySchema>
