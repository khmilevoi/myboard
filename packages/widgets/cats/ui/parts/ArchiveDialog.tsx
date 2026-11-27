import { wrap } from '@reatom/core'
import { X } from 'lucide-react'
import { useRef } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { Button } from 'widget-sdk/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from 'widget-sdk/ui/dialog'

import type { CatRow } from '@/model/all-cats'

import { useCats } from '../cats-context'

import styles from './sheet-fields.module.css'
import sheet from 'module-cats/ui/sheet.module.css'

export type ArchiveDialogProps = {
  /** The cat being archived; null while the dialog is closed. */
  row: CatRow | null
  onOpenChange(open: boolean): void
}

/**
 * "Убрать {name} в архив?" (design page 10): what the archive changes for the other cards, and,
 * when the cat was the last one on her litter, that the litter's night marks stop. The history is
 * kept, and "Вернуть" is in the list below.
 */
export const ArchiveDialog = reatomMemo<ArchiveDialogProps>(({ row, onOpenChange }) => {
  const { card } = useCats()
  // Kept while it closes, so the content does not empty out under the closing animation.
  const shown = useRef<CatRow | null>(row)
  if (row !== null) shown.current = row
  const target = shown.current
  if (target === null) return null

  const impact = card.allCats.archiveImpact(target.id)()
  const failure = card.allCats.failure()

  const onArchive = wrap(async () => {
    const result = await wrap(card.allCats.archive(target.id))
    if (!(result instanceof Error)) onOpenChange(false)
  })

  return (
    <Dialog open={row !== null} onOpenChange={wrap(onOpenChange)}>
      <DialogContent
        fullScreenOnPhone
        className={sheet.sheet}
        overlayClassName={sheet.overlay}
        aria-describedby={undefined}
      >
        <div className={sheet.head}>
          <DialogTitle className={sheet.title}>{`Убрать ${target.name} в архив?`}</DialogTitle>
          <DialogClose asChild>
            <button type="button" className={sheet.close} aria-label="Закрыть">
              <X aria-hidden />
            </button>
          </DialogClose>
        </div>
        <div className={sheet.body}>
          <p className={styles.text}>
            {`${target.name} пропадёт из переключателей. Карточки, где была выбрана она, покажут ${impact.fallbackName}. История кормлений, веса и лотка сохранится — вернуть можно во вкладке «Все кошки».`}
          </p>
          {impact.orphanLitter !== null && (
            <p className={styles.callout}>
              {`${impact.orphanLitter} больше никому не нужен: ночные отметки по нему остановятся.`}
            </p>
          )}
          {failure && (
            <p className={sheet.failure} role="alert">
              {failure}
            </p>
          )}
        </div>
        <div className={`${sheet.foot} ${styles.footRow}`}>
          <DialogClose asChild>
            <Button type="button" variant="outline" className={styles.secondary}>
              Отмена
            </Button>
          </DialogClose>
          <Button type="button" className={styles.primary} onClick={onArchive}>
            В архив
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}, 'CatsArchiveDialog')
