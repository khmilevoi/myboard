import { DUTY_ROTATION } from '../model/ofelia-duty'
import type { Person } from '../model/ofelia-duty'

// One tone per roster slot, assigned by position in DUTY_ROTATION (Леша → 'l'
// blue, Карина → 'k' red). Scales to N participants: add a tone here + matching
// `--ofelia-<tone>-*` tokens — no per-name branching. The palette must be at
// least as long as the roster; the modulo keeps the lookup total either way.
const PERSON_TONES = ['l', 'k'] as const

export type PersonTone = (typeof PERSON_TONES)[number]

export function personInitial(person: Person): string {
  return person.slice(0, 1)
}

export function personTone(person: Person): PersonTone {
  const slot = DUTY_ROTATION.indexOf(person)
  return PERSON_TONES[slot % PERSON_TONES.length]
}
