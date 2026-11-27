import { wrap } from '@reatom/core'
import { X } from 'lucide-react'
import { useId, useRef, type ChangeEvent, type FormEvent } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { Button } from 'widget-sdk/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from 'widget-sdk/ui/dialog'
import { Input } from 'widget-sdk/ui/input'

import { formatDayMonth, formatGrams, formatKg } from '../format'
import { parseDateInput, type WeighForm } from '../model/weigh-form'

import sheet from './sheet.module.css'
import styles from './WeighDialog.module.css'

export type WeighDialogProps = {
  form: WeighForm
  /** The cat's name, for the title "Вес · Офелия". */
  name: string
  open: boolean
  onOpenChange(open: boolean): void
}

/**
 * The "Вес" sheet (design page 10, "Вес · Офелия", normal and input error): a centred sheet on
 * the desktop, full-screen on the phone. Closes itself once a weighing is saved.
 */
export const WeighDialog = reatomMemo<WeighDialogProps>(({ form, name, open, onOpenChange }) => {
  const kgId = useId()
  const hintId = useId()
  const errorId = useId()
  const dateId = useId()
  const dateNoteId = useId()
  const kgInput = useRef<HTMLInputElement>(null)

  const text = form.text()
  const error = form.error()
  const failure = form.failure()
  const previous = form.previous()
  const date = form.date()
  const saving = !form.submit.ready()

  const onSubmit = wrap(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const sends = form.canSend()
    const result = await wrap(form.submit())
    if (result instanceof Error || !sends) return
    onOpenChange(false)
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
          kgInput.current?.focus()
        }}
      >
        <div className={sheet.head}>
          <DialogTitle className={sheet.title}>{`Вес · ${name}`}</DialogTitle>
          <DialogClose asChild>
            <button type="button" className={sheet.close} aria-label="Закрыть">
              <X aria-hidden />
            </button>
          </DialogClose>
        </div>
        <form className={sheet.form} onSubmit={onSubmit} noValidate>
          <div className={sheet.body}>
            <div>
              <label className={styles.label} htmlFor={kgId}>
                Сколько весит
              </label>
              <div className={styles.kgBox} data-invalid={error !== null}>
                <Input
                  ref={kgInput}
                  id={kgId}
                  className={styles.kgInput}
                  inputMode="decimal"
                  autoComplete="off"
                  value={text}
                  aria-invalid={error !== null}
                  aria-describedby={error === null ? hintId : errorId}
                  onChange={wrap((event: ChangeEvent<HTMLInputElement>) =>
                    form.text.set(event.target.value),
                  )}
                />
                <span className={styles.unit}>кг</span>
              </div>
              {error === null ? (
                <p id={hintId} className={styles.note}>
                  Удобно: взвеситься с кошкой на руках и вычесть свой вес.
                </p>
              ) : (
                <p id={errorId} className={styles.error}>
                  {error}
                </p>
              )}
            </div>
            {previous && (
              <p className={styles.previous}>
                Прошлый раз <span className={styles.mono}>{formatKg(previous.kg)}</span>,{' '}
                {formatDayMonth(previous.at)}
                {previous.deltaGrams !== null && (
                  <>
                    {' — '}
                    <b className={styles.delta}>{formatGrams(previous.deltaGrams)}</b>
                  </>
                )}
              </p>
            )}
            <div>
              <label className={styles.label} htmlFor={dateId}>
                Дата
              </label>
              <Input
                id={dateId}
                type="date"
                className={styles.dateInput}
                value={date?.toString() ?? ''}
                aria-describedby={dateNoteId}
                onChange={wrap((event: ChangeEvent<HTMLInputElement>) =>
                  form.pickDate(parseDateInput(event.target.value)),
                )}
              />
              <p id={dateNoteId} className={styles.note}>
                По умолчанию сегодня
              </p>
            </div>
          </div>
          <div className={sheet.foot}>
            {failure && (
              <p className={sheet.failure} role="alert">
                {failure}
              </p>
            )}
            <Button
              type="submit"
              className={styles.save}
              disabled={error !== null || date === null || saving}
            >
              Сохранить вес
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}, 'WeighDialog')
