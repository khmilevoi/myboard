import type { Profile } from '@modules/health/domain/profile'
import type { ScaleProfile } from '@shared/hardware/spike-assumptions'

/** What the scale is told about its user. Pending the spike: the one mapping it may change. */
export function scaleProfileFromHealth(profile: Profile): ScaleProfile {
  return { heightCm: profile.heightCm, birthDate: profile.birthDate, sex: profile.sex }
}
