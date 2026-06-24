import { DUTY_ROTATION } from 'widgets/ofelia-poop-duty/model/ofelia-duty'
import type { Person } from 'widgets/ofelia-poop-duty/model/ofelia-duty'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { personInitial } from '../person'

import styles from './UserToggle.module.css'

export type UserToggleProps = {
  value: Person
  onChange: (person: Person) => void
}

export const UserToggle = reatomMemo<UserToggleProps>(({ value, onChange }) => {
  return (
    <div className={styles.root}>
      <span className={styles.label}>Я:</span>
      {DUTY_ROTATION.map((person) => {
        const active = person === value
        return (
          <button
            key={person}
            type="button"
            className={styles.option}
            data-active={active}
            aria-pressed={active}
            onClick={() => onChange(person)}
          >
            {personInitial(person)} · {person}
          </button>
        )
      })}
    </div>
  )
}, 'UserToggle')
