import { wrap } from '@reatom/core'
import { ArrowUpRight, Droplets, Plus, Scale } from 'lucide-react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { CatCareModel } from '../model/cat-care'
import type { CatCareForms } from '../model/forms'
import { number, time } from './format'

import styles from './cat-care.module.css'

type TileContentProps = {
  model: CatCareModel
  forms: CatCareForms
  open: (kind: 'food' | 'water' | 'weight' | 'profile') => void
  expand?: () => void
}

export const TileContent = reatomMemo<TileContentProps>(({ model, forms, open, expand }) => {
  const day = model.daySummary()
  const confirmed = day.foodCount > day.pendingCount
  const records = forms.dayFoods().slice(0, 2)
  return (
    <div className={styles.tileMain}>
      <div className={styles.tileScroll}>
        <section
          className={styles.tileSummary}
          aria-label="Питание за день"
          data-testid="cat-care-tile-summary"
        >
          <span className={styles.eyebrow}>{model.selectedDate() ?? 'Сегодня'} · съедено</span>
          <div className={styles.energyNumber}>
            <strong data-testid="cat-care-eaten-kcal">
              {confirmed ? number(day.eatenKcal, 0) : '—'}
            </strong>
            <span>{day.targetKcal ? `/ ${number(day.targetKcal, 0)} ккал` : 'ккал'}</span>
          </div>
          {day.pendingCount > 0 ? (
            <p className={styles.tilePending} data-testid="cat-care-pending-kcal">
              Ожидает: до {number(day.pendingKcal)} ккал
            </p>
          ) : (
            <p className={styles.hint}>
              {day.foodCount === 0 ? 'Кормлений пока нет' : `${day.foodCount} кормл. за день`}
            </p>
          )}
          {day.targetKcal && confirmed && (
            <div
              className={styles.progress}
              role="progressbar"
              aria-label="Съедено относительно цели"
              aria-valuemin={0}
              aria-valuemax={day.targetKcal}
              aria-valuenow={Math.min(day.eatenKcal, day.targetKcal)}
              aria-valuetext={`${number(day.eatenKcal)} из ${number(day.targetKcal)} ккал`}
            >
              <span
                style={{ width: `${Math.min((day.eatenKcal / day.targetKcal) * 100, 100)}%` }}
              />
            </div>
          )}
          <p className={styles.tileTiming}>
            По времени записей кормления
            {day.hasEstimatedTiming ? '. Точное время съеденного неизвестно.' : '.'}
          </p>
        </section>
        <section className={styles.tileDetails} aria-label="Последние кормления">
          <h3>Последние кормления</h3>
          {records.length ? (
            <ul className={styles.records}>
              {records.map((record) => (
                <li key={record.id} className={styles.tileRecord}>
                  <strong>{record.snapshot.name}</strong>
                  <span>
                    {record.mode === 'eaten' ? 'Съедено' : 'Выдано'} {number(record.grams)} г
                  </span>
                  <time dateTime={new Date(record.occurredAt).toISOString()}>
                    {time(record.occurredAt, model.profile().timeZone)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.hint}>Запишите первую порцию — она появится здесь.</p>
          )}
          <button className={styles.textButton} onClick={expand}>
            Открыть дневник <ArrowUpRight size={15} />
          </button>
        </section>
      </div>
      <div className={styles.tileActions}>
        <button
          className={styles.primary}
          onClick={wrap(() => open('food'))}
          aria-label="Кормление"
          title="Записать кормление"
          data-testid="cat-care-quick-food"
        >
          <Plus size={17} aria-hidden />
          <span className={styles.tileFoodLabel}>Кормление</span>
        </button>
        <button
          className={`${styles.secondary} ${styles.tileSecondary}`}
          onClick={wrap(() => open('water'))}
          aria-label="Вода"
          title="Записать воду"
        >
          <Droplets size={17} aria-hidden />
          <span>Вода</span>
        </button>
        <button
          className={`${styles.secondary} ${styles.tileSecondary}`}
          onClick={wrap(() => open('weight'))}
          aria-label="Вес"
          title="Записать вес"
        >
          <Scale size={17} aria-hidden />
          <span>Вес</span>
        </button>
      </div>
    </div>
  )
}, 'CatCare.TileContent')
