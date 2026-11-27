import { type Profile, ProfileSchema } from 'module-health/domain/profile'

/** The `ScaleProfileSchema` fields the §4(c2) form fills; a test pins it to the schema's keys. */
export const SCALE_PROFILE_FORM_FIELDS = ['birthDate', 'heightCm', 'sex'] as const

/** The raw §4(c2) inputs: height and birth date as typed, birth date as `ДД.ММ.ГГГГ`. */
export type ProfileFormInput = { height: string; birthDate: string; sex: 'male' | 'female' | null }

export type ProfileFormField = 'height' | 'birthDate' | 'sex'

export const EMPTY_PROFILE_FORM: ProfileFormInput = { height: '', birthDate: '', sex: null }

const BIRTH_DATE_INPUT = /^(\d{2})\.(\d{2})\.(\d{4})$/
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** `ДД.ММ.ГГГГ` → `YYYY-MM-DD`; null for anything else or a date that does not exist. */
export function parseBirthDate(input: string): string | null {
  const match = BIRTH_DATE_INPUT.exec(input.trim())
  if (match === null) return null
  const [, day, month, year] = match
  const iso = `${year}-${month}-${day}`
  const at = Date.parse(`${iso}T00:00:00Z`)
  // Date.parse rolls 31.02 over to March; the round-trip catches it.
  if (Number.isNaN(at) || !new Date(at).toISOString().startsWith(iso)) return null
  return iso
}

/** `YYYY-MM-DD` → `ДД.ММ.ГГГГ`; anything else is returned unchanged. */
export function formatBirthDate(iso: string): string {
  const match = ISO_DATE.exec(iso)
  if (match === null) return iso
  const [, year, month, day] = match
  return `${day}.${month}.${year}`
}

/** The stored profile; the first invalid field otherwise, in form order. */
export function parseProfileForm(input: ProfileFormInput): Profile | { field: ProfileFormField } {
  const heightText = input.height.trim().replace(',', '.')
  const heightCm = heightText === '' ? Number.NaN : Number(heightText)
  if (!ProfileSchema.shape.heightCm.safeParse(heightCm).success) return { field: 'height' }
  const birthDate = parseBirthDate(input.birthDate)
  if (birthDate === null || !ProfileSchema.shape.birthDate.safeParse(birthDate).success) {
    return { field: 'birthDate' }
  }
  if (input.sex === null) return { field: 'sex' }
  return { heightCm, birthDate, sex: input.sex }
}

/** Decision 10: "complete" is what `ProfileSchema` accepts; `null` never is. */
export function isProfileComplete(profile: unknown): profile is Profile {
  return ProfileSchema.safeParse(profile).success
}

/** Prefills the form from whatever the stored profile has. */
export function profileToForm(profile: Partial<Profile> | null): ProfileFormInput {
  if (profile === null) return EMPTY_PROFILE_FORM
  return {
    height: profile.heightCm === undefined ? '' : String(profile.heightCm),
    birthDate: profile.birthDate === undefined ? '' : formatBirthDate(profile.birthDate),
    sex: profile.sex ?? null,
  }
}
