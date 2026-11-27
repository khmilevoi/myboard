import { wrap } from '@reatom/core'
import { X } from 'lucide-react'
import { parseDateInput } from 'module-cats/weigh-form'
import { useId, useRef, type ChangeEvent, type FormEvent } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { Button } from 'widget-sdk/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from 'widget-sdk/ui/dialog'
import { Input } from 'widget-sdk/ui/input'
import { ToggleGroup, ToggleGroupItem } from 'widget-sdk/ui/toggle-group'

import { ADD_FAILED, type AddCatForm } from '@/model/add-cat-form'
import { litterValue } from '@/model/profile-form'

import { LitterMark } from './LitterMark'

import styles from './sheet-fields.module.css'
import sheet from 'module-cats/ui/sheet.module.css'

const SEX_OPTIONS = [
  { value: 'female', label: 'Кошка' },
  { value: 'male', label: 'Кот' },
] as const

export type AddCatDialogProps = {
  form: AddCatForm
  open: boolean
  onOpenChange(open: boolean): void
}

/**
 * The "Новая кошка" sheet (design page 10): a name, a birth date, a sex and the litter. A saved cat
 * closes it, and the card's `onAdded` (see `makeCatsCard`) chooses the cat and opens its profile.
 */
export const AddCatDialog = reatomMemo<AddCatDialogProps>(({ form, open, onOpenChange }) => {
  const nameId = useId()
  const nameErrorId = useId()
  const birthId = useId()
  const nameInput = useRef<HTMLInputElement>(null)

  const name = form.name()
  const birthDate = form.birthDate()
  const maxBirthDate = form.maxBirthDate()
  const sex = form.sex()
  const litter = form.litter()
  const options = form.litterOptions()
  const issues = form.issues()
  const saving = form.saving()
  const failed = form.failed()

  const onSubmit = wrap(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = await wrap(form.submit())
    if (result && !(result instanceof Error)) onOpenChange(false)
  })

  return (
    <Dialog open={open} onOpenChange={wrap(onOpenChange)}>
      <DialogContent
        fullScreenOnPhone
        className={sheet.sheet}
        overlayClassName={sheet.overlay}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          nameInput.current?.focus()
        }}
      >
        <div className={sheet.head}>
          <DialogTitle className={sheet.title}>Новая кошка</DialogTitle>
          <DialogClose asChild>
            <button type="button" className={sheet.close} aria-label="Закрыть">
              <X aria-hidden />
            </button>
          </DialogClose>
        </div>
        <form className={sheet.form} onSubmit={onSubmit} noValidate>
          <div className={sheet.body}>
            <div>
              <label className={styles.label} htmlFor={nameId}>
                Имя
              </label>
              <Input
                ref={nameInput}
                id={nameId}
                className={styles.input}
                maxLength={40}
                autoComplete="off"
                value={name}
                aria-invalid={issues.name !== undefined}
                aria-describedby={issues.name === undefined ? undefined : nameErrorId}
                onChange={wrap((event: ChangeEvent<HTMLInputElement>) =>
                  form.name.set(event.target.value),
                )}
              />
              {issues.name && (
                <p id={nameErrorId} className={styles.error}>
                  {issues.name}
                </p>
              )}
            </div>
            <div className={styles.pair}>
              <div>
                <label className={styles.label} htmlFor={birthId}>
                  Дата рождения
                </label>
                <Input
                  id={birthId}
                  type="date"
                  className={styles.dateInput}
                  value={birthDate ?? ''}
                  max={maxBirthDate?.toString()}
                  onChange={wrap((event: ChangeEvent<HTMLInputElement>) =>
                    form.birthDate.set(parseDateInput(event.target.value)?.toString() ?? null),
                  )}
                />
              </div>
              <div>
                <span className={styles.label}>Пол</span>
                <ToggleGroup
                  type="single"
                  className={styles.seg}
                  aria-label="Пол"
                  value={sex}
                  onValueChange={wrap((next: string) => {
                    // An empty value is a press on the chosen item: keep it chosen.
                    if (next !== '') form.sex.set(next === 'male' ? 'male' : 'female')
                  })}
                >
                  {SEX_OPTIONS.map(({ value, label }) => (
                    <ToggleGroupItem key={value} value={value} className={styles.segItem}>
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>
            {options !== null && (
              <div>
                <span className={styles.label}>Лоток</span>
                <ToggleGroup
                  type="single"
                  orientation="vertical"
                  className={styles.options}
                  aria-label="Лоток"
                  value={litterValue(litter)}
                  onValueChange={wrap((value: string) => {
                    // An empty value is a press on the chosen item: the field always has a litter.
                    const option = options.find((candidate) => candidate.value === value)
                    if (option) form.litter.set(option.choice)
                  })}
                >
                  {options.map((option) => (
                    <ToggleGroupItem
                      key={option.value}
                      value={option.value}
                      className={styles.option}
                    >
                      <LitterMark cats={option.cats} />
                      <span className={styles.optionTitle}>{option.title}</span>
                      <span className={styles.optionNote}>{option.note}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            )}
            <p className={styles.note}>
              {`Порода, вес, упитанность и цель — потом, в профиле. Сразу после сохранения ${
                name.trim() || 'новая кошка'
              } появится в переключателе у всех кошачьих карточек.`}
            </p>
          </div>
          <div className={sheet.foot}>
            {failed && (
              <p className={sheet.failure} role="alert">
                {ADD_FAILED}
              </p>
            )}
            <Button type="submit" className={styles.primary} disabled={saving}>
              Добавить кошку
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}, 'CatsAddCatDialog')
