import { z } from 'zod'

export const ProfileSchema = z.object({
  heightCm: z.number().min(100).max(250),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => {
      const t = Date.parse(`${s}T00:00:00Z`)
      return !Number.isNaN(t) && new Date(t).toISOString().startsWith(s) && t < Date.now()
    }, 'birthDate must be a valid date in the past'),
  sex: z.enum(['male', 'female']),
})

export type Profile = z.infer<typeof ProfileSchema>
