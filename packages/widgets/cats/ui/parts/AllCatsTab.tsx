import { wrap } from '@reatom/core'
import { Plus } from 'lucide-react'
import { CatAvatar } from 'module-cats/ui/CatAvatar'
import { useId, useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { ArchivedRow, CatRow } from '@/model/all-cats'

import { useCats } from '../cats-context'
import { AddCatDialog } from './AddCatDialog'
import { ArchiveDialog } from './ArchiveDialog'

import styles from './AllCatsTab.module.css'

/** Why the last cat's "В архив" is off (page 10, "Все кошки · одна кошка"). */
export const LAST_CAT_HINT =
  'Последнюю кошку в архив не убрать — на борде всегда есть кого показывать. Сначала добавьте другую.'

const RowText = reatomMemo<{ row: CatRow | ArchivedRow }>(
  ({ row }) => (
    <div className={styles.text}>
      <p className={styles.name}>{row.name}</p>
      <p className={styles.line}>{row.line}</p>
    </div>
  ),
  'CatsAllCatsRowText',
)

/**
 * `CatsLarge` ALL CATS: every cat on the board with "Открыть" and "В архив", the archived ones
 * folded below with "Вернуть", and "Добавить кошку" opening the "Новая кошка" sheet. The last
 * active cat cannot be archived: its button stays focusable, announces why, and does nothing.
 */
export const AllCatsTab = reatomMemo(() => {
  const { card } = useCats()
  const hintId = useId()
  // Per mount: the board tile and the fullscreen mount must not both open a dialog.
  const [addOpen, setAddOpen] = useState(false)
  const [archiving, setArchiving] = useState<CatRow | null>(null)

  const all = card.allCats
  const active = all.active()
  const archived = all.archived()
  if (active === null) return null
  const lastActive = all.lastActive()
  const failure = all.failure()

  const onOpen = wrap((row: CatRow) => {
    void card.choice.choose(row.id)
    card.tab.set('profile')
  })
  const onArchive = wrap((row: CatRow) => {
    if (lastActive) return
    all.clearFailure()
    setArchiving(row)
  })
  const onRestore = wrap((row: ArchivedRow) => {
    void all.restore(row.id)
  })

  return (
    <section className={styles.root} aria-label="Все кошки">
      <div className={styles.head}>
        <span className={styles.label}>{`Кошки на борде · ${active.length}`}</span>
        <button type="button" className={styles.primary} onClick={wrap(() => setAddOpen(true))}>
          <Plus aria-hidden />
          Добавить кошку
        </button>
      </div>
      <ul className={styles.box} aria-label="Кошки на борде">
        {active.map((row) => (
          <li key={row.id} className={styles.row}>
            <CatAvatar name={row.name} tone={row.tone} photoUrl={row.photoUrl} size="row" />
            <RowText row={row} />
            <button type="button" className={styles.action} onClick={() => onOpen(row)}>
              Открыть
            </button>
            <button
              type="button"
              className={styles.action}
              aria-disabled={lastActive || undefined}
              aria-describedby={lastActive ? hintId : undefined}
              onClick={() => onArchive(row)}
            >
              В архив
            </button>
          </li>
        ))}
      </ul>
      {lastActive && (
        <p id={hintId} className={styles.note}>
          {LAST_CAT_HINT}
        </p>
      )}
      {archived !== null && archived.length > 0 && (
        <details className={styles.archive}>
          <summary className={styles.summary}>{`В архиве · ${archived.length}`}</summary>
          <ul className={styles.archiveList} aria-label="В архиве">
            {archived.map((row) => (
              <li key={row.id} className={styles.row}>
                <span className={styles.dim}>
                  <CatAvatar name={row.name} tone={row.tone} photoUrl={row.photoUrl} size="row" />
                </span>
                <RowText row={row} />
                <button type="button" className={styles.action} onClick={() => onRestore(row)}>
                  Вернуть
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {failure && archiving === null && (
        <p className={styles.failure} role="alert">
          {failure}
        </p>
      )}
      <AddCatDialog form={card.addCatForm} open={addOpen} onOpenChange={setAddOpen} />
      <ArchiveDialog row={archiving} onOpenChange={(open) => !open && setArchiving(null)} />
    </section>
  )
}, 'CatsAllCatsTab')
