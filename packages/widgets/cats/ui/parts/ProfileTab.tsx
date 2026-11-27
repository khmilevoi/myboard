import { wrap } from '@reatom/core'
import type { GoalHintReason } from 'module-cats'
import type { CatProfileFields } from 'module-cats/domain/cat'
import { formatAge, formatDayMonth, formatKg } from 'module-cats/format'
import { parseDateInput } from 'module-cats/weigh-form'
import { useId, type ChangeEvent, type FormEvent } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { Button } from 'widget-sdk/ui/button'
import { Input } from 'widget-sdk/ui/input'
import { ToggleGroup, ToggleGroupItem } from 'widget-sdk/ui/toggle-group'

import type { GoalForm } from '@/model/goal-form'
import { litterValue, type ProfileForm } from '@/model/profile-form'

import { useCats } from '../cats-context'
import { AvatarField } from './AvatarField'
import { LitterMark } from './LitterMark'

import styles from './ProfileTab.module.css'

/** Copy for a failed profile or goal save; the design draws none (reported as an open item). */
export const SAVE_FAILED = 'Не удалось сохранить. Попробуйте ещё раз.'

const SEX_OPTIONS = [
  { value: 'female', label: 'Кошка' },
  { value: 'male', label: 'Кот' },
] as const
const STERILIZED_OPTIONS = [
  { value: 'yes', label: 'Да' },
  { value: 'no', label: 'Нет' },
  { value: 'unknown', label: 'Не знаю' },
] as const
const BODY_CONDITIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

const HINT_MISSING = 'Ориентир появится, когда будут вес, возраст и стерилизация'
const HINT_VET = 'Для этой кошки ориентир подбирает ветеринар'
const HINT_VET_NOTE = 'Котёнок до года, кошка старше 10 лет или упитанность не 4–5.'
const VET_REASONS: ReadonlySet<GoalHintReason> = new Set(['kitten', 'senior', 'body_condition'])

// The goal is saved on its own, from today, and never through the profile footer.
const GoalBox = reatomMemo<{ form: GoalForm }>(({ form }) => {
  const inputId = useId()
  const errorId = useId()
  const current = form.current()
  const previous = form.previous()
  const hint = form.hint()
  const text = form.text()
  const error = form.error()
  const saving = form.saving()

  const onSubmit = wrap((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void form.save()
  })

  return (
    <section className={styles.box} aria-label="Суточная цель">
      <span className={styles.label}>Суточная цель</span>
      {current && (
        <p className={styles.goal}>
          <span className={styles.goalFigure}>{current.kcal}</span>
          <span className={styles.goalUnit}>
            {`ккал в сутки · с ${formatDayMonth(current.since)}`}
          </span>
        </p>
      )}
      {hint?.kind === 'available' && (
        <div className={styles.hint}>
          <p className={styles.hintText}>
            {`Ориентир по весу ${formatKg(hint.weightKg)} — `}
            <b className={styles.mono}>{`≈ ${hint.kcal}`}</b>
            {' ккал'}
          </p>
          <Button
            type="button"
            variant="outline"
            className={styles.secondary}
            disabled={saving}
            onClick={wrap(() => void form.take())}
          >
            Взять
          </Button>
        </div>
      )}
      {hint?.kind === 'unavailable' && (
        <>
          <p className={styles.hintOff}>{VET_REASONS.has(hint.reason) ? HINT_VET : HINT_MISSING}</p>
          {VET_REASONS.has(hint.reason) && <p className={styles.note}>{HINT_VET_NOTE}</p>}
        </>
      )}
      <form className={styles.ownGoal} onSubmit={onSubmit} noValidate>
        <div className={styles.ownGoalField}>
          <label className={styles.fieldLabel} htmlFor={inputId}>
            Своя цель
          </label>
          <div className={styles.inline}>
            <Input
              id={inputId}
              className={styles.goalInput}
              inputMode="numeric"
              autoComplete="off"
              value={text}
              aria-invalid={error !== null}
              aria-describedby={error === null ? undefined : errorId}
              onChange={wrap((event: ChangeEvent<HTMLInputElement>) =>
                form.text.set(event.target.value),
              )}
            />
            <span className={styles.goalUnit}>ккал в сутки, с сегодня</span>
          </div>
        </div>
        <Button type="submit" variant="outline" className={styles.secondaryTall} disabled={saving}>
          Сохранить цель
        </Button>
      </form>
      {error && (
        <p id={errorId} className={styles.fieldError}>
          {error}
        </p>
      )}
      {form.saveFailed() && (
        <p className={styles.fieldError} role="alert">
          {SAVE_FAILED}
        </p>
      )}
      {previous && (
        <p className={styles.note}>
          {`Раньше ${previous.kcal} ккал. Прошлые дни считаются по своей цели. Цель видна в «миске дня» в питании.`}
        </p>
      )}
    </section>
  )
}, 'CatsGoalBox')

const LitterBox = reatomMemo<{ form: ProfileForm }>(({ form }) => {
  const noteId = useId()
  const options = form.litterOptions()
  const litter = form.litter()
  if (options === null || litter === null) return null

  const onChange = wrap((value: string) => {
    const option = options.find((candidate) => candidate.value === value)
    // An empty value is a press on the chosen item: the field always has a litter.
    if (option) form.chooseLitter(option.choice)
  })

  return (
    <section className={styles.box} aria-label="Лоток">
      <span className={styles.label}>Лоток</span>
      <ToggleGroup
        type="single"
        orientation="vertical"
        className={styles.options}
        aria-label="Лоток"
        aria-describedby={noteId}
        value={litterValue(litter)}
        onValueChange={onChange}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value} className={styles.option}>
            <LitterMark cats={option.cats} />
            <span className={styles.optionTitle}>{option.title}</span>
            {option.note && <span className={styles.optionNote}>{option.note}</span>}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p id={noteId} className={styles.note}>
        Выбрать лоток другой кошки — значит делить его: общая очередь и общий долг. Новый лоток —
        своя очередь и отдельная карточка «Лоток».
      </p>
    </section>
  )
}, 'CatsLitterBox')

const Segmented = reatomMemo<{
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
}>(
  ({ label, value, options, onChange }) => (
    <ToggleGroup
      type="single"
      className={styles.seg}
      aria-label={label}
      value={value}
      onValueChange={wrap((next: string) => {
        // An empty value is a press on the chosen item: keep it chosen.
        if (next !== '') onChange(next)
      })}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className={styles.segItem}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  ),
  'CatsSegmented',
)

/**
 * `CatsLarge` PROFILE: "О кошке" (photo, name, breed, birth date and age, sex, sterilized, body
 * condition) beside "Суточная цель" and "Лоток", over a footer that saves the profile. The goal is
 * saved on its own.
 */
export const ProfileTab = reatomMemo(() => {
  const { card } = useCats()
  const nameId = useId()
  const nameErrorId = useId()
  const breedId = useId()
  const birthId = useId()
  const form = card.profileForm
  const current = card.choice.current()
  const draft = form.draft()
  if (current === null || draft === null) return null
  const issues = form.issues()
  const dirty = form.dirty()
  const saving = form.saving()
  const today = card.handle.model()?.today() ?? null
  const birth = draft.birthDate === null ? null : Temporal.PlainDate.from(draft.birthDate)
  const age = birth === null || today === null ? null : formatAge(birth, today, 'long')
  const hasIssues = Object.keys(issues).length > 0

  // Called only from the wrapped handlers below.
  const edit = (patch: Partial<CatProfileFields>) => form.edit(patch)
  const onText =
    (key: 'name' | 'breed') =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      const { value } = event.target
      edit(key === 'breed' ? { breed: value.trim() === '' ? null : value } : { name: value })
    }

  return (
    <div className={styles.root}>
      <div className={styles.columns}>
        <section className={styles.box} aria-label="О кошке">
          <span className={styles.label}>О кошке</span>
          <AvatarField name={draft.name} tone={current.tone} photoUrl={current.avatar} />
          <div>
            <label className={styles.fieldLabel} htmlFor={nameId}>
              Имя
            </label>
            <Input
              id={nameId}
              className={styles.input}
              maxLength={40}
              autoComplete="off"
              value={draft.name}
              aria-invalid={issues.name !== undefined}
              aria-describedby={issues.name === undefined ? undefined : nameErrorId}
              onChange={wrap(onText('name'))}
            />
            {issues.name && (
              <p id={nameErrorId} className={styles.fieldError}>
                {issues.name}
              </p>
            )}
          </div>
          <div>
            <label className={styles.fieldLabel} htmlFor={breedId}>
              Порода
            </label>
            <Input
              id={breedId}
              className={styles.input}
              maxLength={60}
              autoComplete="off"
              value={draft.breed ?? ''}
              onChange={wrap(onText('breed'))}
            />
          </div>
          <div className={styles.pair}>
            <div>
              <label className={styles.fieldLabel} htmlFor={birthId}>
                Дата рождения
              </label>
              <Input
                id={birthId}
                type="date"
                className={styles.dateInput}
                value={draft.birthDate ?? ''}
                onChange={wrap((event: ChangeEvent<HTMLInputElement>) =>
                  form.edit({
                    birthDate: parseDateInput(event.target.value)?.toString() ?? null,
                  }),
                )}
              />
              {age && <p className={styles.note}>{age}</p>}
            </div>
            <div>
              <span className={styles.fieldLabel}>Пол</span>
              <Segmented
                label="Пол"
                value={draft.sex ?? ''}
                options={SEX_OPTIONS}
                onChange={(value) => edit({ sex: value === 'male' ? 'male' : 'female' })}
              />
            </div>
          </div>
          <div>
            <span className={styles.fieldLabel}>Стерилизована</span>
            <Segmented
              label="Стерилизована"
              value={draft.sterilized}
              options={STERILIZED_OPTIONS}
              onChange={(value) =>
                edit({ sterilized: value === 'yes' ? 'yes' : value === 'no' ? 'no' : 'unknown' })
              }
            />
          </div>
          <div>
            <span className={styles.fieldLabel}>Упитанность · 1–9</span>
            <Segmented
              label="Упитанность"
              value={draft.bodyCondition === null ? '' : String(draft.bodyCondition)}
              options={BODY_CONDITIONS.map((value) => ({ value, label: value }))}
              onChange={(value) => edit({ bodyCondition: Number(value) })}
            />
            {issues.bodyCondition && <p className={styles.fieldError}>{issues.bodyCondition}</p>}
            {draft.bodyCondition === 5 && (
              <p className={styles.note}>5 — идеал: рёбра прощупываются, талия видна сверху.</p>
            )}
          </div>
        </section>
        <div className={styles.side}>
          <GoalBox form={card.goalForm} />
          <LitterBox form={form} />
        </div>
      </div>
      <div className={styles.footer}>
        {form.saveFailed() ? (
          <span className={styles.footerFailure} role="alert">
            {SAVE_FAILED}
          </span>
        ) : (
          <span className={styles.footerText}>
            {dirty
              ? 'Изменения не сохранены · цель сохраняется отдельно'
              : 'Все изменения сохранены'}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          className={styles.secondaryTall}
          disabled={!dirty || saving}
          onClick={wrap(() => form.reset())}
        >
          Отменить
        </Button>
        <Button
          type="button"
          className={styles.primary}
          disabled={!dirty || hasIssues || saving}
          onClick={wrap(() => void form.save())}
        >
          Сохранить
        </Button>
      </div>
    </div>
  )
}, 'CatsProfileTab')
