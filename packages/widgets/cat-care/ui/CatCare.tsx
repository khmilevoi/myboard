import { wrap } from '@reatom/core'
import {
  Cat,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Pencil,
  Plus,
  Scale,
  Trash2,
  Utensils,
  ArrowUpRight,
  Settings2,
} from 'lucide-react'
import { getServerTime, useWidgetContext } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { WidgetControls, useWidgetChrome } from 'widget-sdk/ui/WidgetControls'

import type { CatCareEvents } from '../domain/events'
import { CAT_CARE_SOURCES, calculateFoodNutrition } from '../domain/nutrition'
import type { FoodRecord, WeightRecord } from '../domain/schemas'
import { createCatCareModel, type CatCareModel } from '../model/cat-care'
import { createCatCareForms, type CatCareForms } from '../model/forms'
import { catCareInstance } from '../model/instance-store'
import { Editor } from './Editor'
import { date, number, stamp, time } from './format'

import styles from './cat-care.module.css'

type Models = { model: CatCareModel; forms: CatCareForms }
const productKinds = { dry: 'Сухой корм', wet: 'Влажный корм', treat: 'Лакомство', other: 'Другое' }

const RecordActions = reatomMemo<{ edit: () => void; remove: () => void; name: string }>(
  ({ edit, remove, name }) => (
    <div className={styles.recordActions}>
      <button
        type="button"
        className={styles.iconButton}
        onClick={wrap(edit)}
        aria-label={`Изменить ${name}`}
      >
        <Pencil size={15} />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        onClick={wrap(remove)}
        aria-label={`Удалить ${name}`}
      >
        <Trash2 size={15} />
      </button>
    </div>
  ),
  'CatCare.RecordActions',
)

const FoodRow = reatomMemo<Models & { record: FoodRecord; compact?: boolean }>(
  ({ model, forms, record, compact }) => {
    const portion = calculateFoodNutrition(record)
    return (
      <li className={styles.record} data-testid="cat-care-food-record">
        <span className={styles.recordIcon}>
          <Utensils size={17} />
        </span>
        <div className={styles.recordBody}>
          <strong>{record.snapshot.name}</strong>
          <span>
            {record.mode === 'eaten'
              ? `Съедено ${number(record.grams)} г`
              : portion.eatenGrams === null
                ? `Выдано ${number(record.grams)} г · остаток не измерен`
                : `Съедено ${number(portion.eatenGrams)} из ${number(record.grams)} г`}
            {!compact && record.note ? ` · ${record.note}` : ''}
          </span>
        </div>
        <div className={styles.recordAmount}>
          <strong>
            {portion.eatenKcal === null ? 'ожидает' : `${number(portion.eatenKcal)} ккал`}
          </strong>
          <time dateTime={new Date(record.occurredAt).toISOString()}>
            {time(record.occurredAt, model.profile().timeZone)}
          </time>
        </div>
        {!compact && (
          <RecordActions
            name={`кормление ${record.snapshot.name}`}
            edit={() => forms.openFood(record)}
            remove={() => forms.deletion.set({ entity: 'food', id: record.id })}
          />
        )}
      </li>
    )
  },
  'CatCare.FoodRow',
)

const EnergySummary = reatomMemo<{ model: CatCareModel; compact?: boolean }>(
  ({ model, compact }) => {
    const day = model.daySummary()
    const progress = day.targetKcal ? Math.min((day.eatenKcal / day.targetKcal) * 100, 100) : 0
    return (
      <section className={styles.energy} aria-label="Питание за день">
        <span className={styles.eyebrow}>Съедено за день</span>
        <div className={styles.energyNumber}>
          <strong data-testid="cat-care-eaten-kcal">
            {day.foodCount > day.pendingCount ? number(day.eatenKcal, 0) : '—'}
          </strong>
          <span>{day.targetKcal ? `/ ${number(day.targetKcal, 0)} ккал` : 'ккал'}</span>
        </div>
        {day.targetKcal && day.foodCount > day.pendingCount && (
          <div
            className={styles.progress}
            role="progressbar"
            aria-label="Съедено относительно цели"
            aria-valuemin={0}
            aria-valuemax={day.targetKcal}
            aria-valuenow={Math.min(day.eatenKcal, day.targetKcal)}
            aria-valuetext={`${number(day.eatenKcal)} из ${number(day.targetKcal)} ккал`}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        )}
        <p className={styles.hint}>
          {day.foodCount === 0
            ? 'Кормлений пока нет'
            : day.foodCount === day.pendingCount
              ? 'Пока нет подтверждений съеденного'
              : day.targetKcal === null
                ? 'Суточную цель можно задать в профиле'
                : day.eatenKcal > day.targetKcal
                  ? `На ${number(day.eatenKcal - day.targetKcal)} ккал выше выбранной цели`
                  : `${number(Math.max(0, day.targetKcal - day.eatenKcal))} ккал до выбранной цели`}
        </p>
        {day.pendingCount > 0 && (
          <p className={styles.pending} data-testid="cat-care-pending-kcal">
            Ожидает уточнения: до {number(day.pendingKcal)} ккал · {day.pendingCount} порц.
          </p>
        )}
        {!compact && (
          <>
            <div className={styles.macros}>
              {[
                ['Белки', day.proteinGrams],
                ['Жиры', day.fatGrams],
                ['Углеводы', day.carbsGrams],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <span>{label}</span>
                  <strong>
                    {day.foodCount > day.pendingCount ? number(value as number | null) : '—'}{' '}
                    <small>г</small>
                  </strong>
                </div>
              ))}
            </div>
            {day.hasUnknownMacros && (
              <p className={styles.hint}>
                Не весь состав указан на этикетках — неизвестное не считаем нулём.
              </p>
            )}
          </>
        )}
        <p className={styles.fine}>
          По времени записей кормления
          {day.hasEstimatedTiming ? '. Точное время съеденного неизвестно.' : ''}
        </p>
      </section>
    )
  },
  'CatCare.EnergySummary',
)

const WeightChart = reatomMemo<{ records: WeightRecord[]; timeZone: string }>(
  ({ records, timeZone }) => {
    if (!records.length) return <p className={styles.hint}>Добавьте вес, чтобы видеть изменения.</p>
    const first = records[0]!
    const last = records.at(-1)!
    const low = Math.min(...records.map((record) => record.kilograms))
    const high = Math.max(...records.map((record) => record.kilograms))
    const span = Math.max(high - low, 0.2)
    const points = records.map((record) => ({
      x:
        records.length === 1
          ? 160
          : 10 +
            ((record.occurredAt - first.occurredAt) /
              Math.max(1, last.occurredAt - first.occurredAt)) *
              300,
      y: 70 - ((record.kilograms - low) / span) * 45,
      record,
    }))
    return (
      <>
        <svg
          className={styles.chart}
          viewBox="0 0 320 100"
          role="img"
          aria-label={`Динамика веса: ${records.map((record) => `${date(record.occurredAt, timeZone)} — ${number(record.kilograms)} кг`).join('; ')}`}
        >
          <line x1="10" y1="80" x2="310" y2="80" className={styles.chartAxis} />
          <polyline
            points={points.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          {points.map((point) => (
            <circle key={point.record.id} cx={point.x} cy={point.y} r="3" fill="currentColor">
              <title>
                {date(point.record.occurredAt, timeZone)}: {number(point.record.kilograms)} кг
              </title>
            </circle>
          ))}
        </svg>
        <div className={styles.chartDates}>
          <span>{date(first.occurredAt, timeZone)}</span>
          <span>{date(last.occurredAt, timeZone)}</span>
        </div>
      </>
    )
  },
  'CatCare.WeightChart',
)

const SideCards = reatomMemo<Models>(({ model, forms }) => {
  const water = model.waterIntervals().at(-1)
  const weight = model.latestWeight()
  const zone = model.profile().timeZone
  const lastWater = model
    .water()
    .toSorted((a, b) => a.occurredAt - b.occurredAt)
    .at(-1)
  return (
    <aside className={styles.sideCards}>
      <section className={styles.card}>
        <div className={styles.sectionHeading}>
          <h3>
            <Droplets size={18} />
            Вода
          </h3>
          <button
            className={styles.textButton}
            onClick={wrap(() => forms.openWater())}
            aria-label="Добавить запись о воде"
          >
            <Plus size={17} />
          </button>
        </div>
        <div className={styles.cardNumber} data-testid="cat-care-water-interval">
          {water?.volumeMl != null ? `≈ ${number(water.volumeMl)} мл` : 'Нет оценки'}
        </div>
        <p className={styles.hint}>
          {water
            ? `${stamp(water.startAt, zone)} → ${stamp(water.endAt, zone)}`
            : lastWater
              ? `Первое измерение ${stamp(lastWater.occurredAt, zone)}. Следующее завершит интервал.`
              : 'Начните с объёма свежей воды в миске.'}
        </p>
        {water && water.durationHours > 24 && water.normalizedMlPerDay !== null && (
          <p className={styles.hint}>
            ≈ {number(water.normalizedMlPerDay)} мл/сут в среднем за интервал
          </p>
        )}
        {water?.status === 'unknown' && (
          <p className={styles.hint}>
            {water.reason === 'unmeasured_loss'
              ? 'Были неизмеренные потери.'
              : water.reason === 'invalid_balance'
                ? 'Проверьте объёмы записей.'
                : 'Не хватает измерения остатка.'}
          </p>
        )}
        <p className={styles.fine}>
          Разница объёмов приблизительна: испарение и проливы могут завысить оценку. Не суточная
          норма.
        </p>
        <div className={styles.divider} />
        <p className={styles.hint}>
          Влага из еды за выбранный день:{' '}
          <strong>
            {model.daySummary().foodCount > model.daySummary().pendingCount
              ? number(model.daySummary().foodMoistureMl)
              : '—'}{' '}
            мл
          </strong>
        </p>
        <p className={styles.fine}>
          По влажности с этикеток. Не складываем с водой за другой интервал.
        </p>
      </section>
      <section className={styles.card}>
        <div className={styles.sectionHeading}>
          <h3>
            <Scale size={18} />
            Вес
          </h3>
          <button
            className={styles.textButton}
            onClick={wrap(() => forms.openWeight())}
            aria-label="Добавить измерение веса"
          >
            <Plus size={17} />
          </button>
        </div>
        <div className={styles.cardNumber}>
          {weight ? `${number(weight.kilograms, 2)} кг` : 'Нет измерений'}
        </div>
        {weight && <p className={styles.hint}>{stamp(weight.occurredAt, zone)}</p>}
        <WeightChart records={model.weightSeries()} timeZone={zone} />
        <p className={styles.fine}>
          За {model.periodDays()} дней до выбранной даты. Оценивайте вес вместе с упитанностью.
        </p>
      </section>
    </aside>
  )
}, 'CatCare.SideCards')

const History = reatomMemo<Models>(({ model, forms }) => {
  const summary = model.periodSummary()
  const maximum = Math.max(
    1,
    ...summary.days.map((day) => Math.max(day.eatenKcal, day.targetKcal ?? 0)),
  )
  const zone = model.profile().timeZone
  return (
    <div className={styles.contentGrid}>
      <div className={styles.stack}>
        <section className={styles.card}>
          <div className={styles.sectionHeading}>
            <h2>Калории по дням</h2>
            <div className={styles.segment}>
              {([7, 30] as const).map((days) => (
                <button
                  key={days}
                  onClick={wrap(() => model.periodDays.set(days))}
                  aria-pressed={model.periodDays() === days}
                >
                  {days} дней
                </button>
              ))}
            </div>
          </div>
          <p>
            <strong>{number(summary.averageEatenKcal, 0)} ккал</strong> в среднем по подтверждённым
            записям за {summary.confirmedDays} дней{' '}
            <span className={styles.hint}>
              · записи за {summary.loggedDays} из {model.periodDays()} дней
            </span>
          </p>
          <div
            className={styles.bars}
            role="img"
            aria-label="Съеденные калории по дням; подробности в таблице ниже"
          >
            {summary.days.map((day) => (
              <div
                key={day.date}
                className={styles.barColumn}
                title={`${day.date}: ${day.foodCount > day.pendingCount ? `${number(day.eatenKcal)} ккал` : day.foodCount ? 'пока нет подтверждений' : 'нет записей'}`}
              >
                <span
                  className={day.foodCount > day.pendingCount ? styles.bar : styles.noBar}
                  style={{
                    height: `${day.foodCount > day.pendingCount ? Math.max(2, (day.eatenKcal / maximum) * 100) : 2}%`,
                  }}
                />
                {day.targetKcal && (
                  <span
                    className={styles.targetTick}
                    style={{ bottom: `${(day.targetKcal / maximum) * 100}%` }}
                  />
                )}
              </div>
            ))}
          </div>
          <div className={styles.chartDates}>
            <span>{summary.days[0]?.date}</span>
            <span>{summary.days.at(-1)?.date}</span>
          </div>
          <p className={styles.fine}>
            Сплошной столбец — съедено, штрих — цель. Нет записи не означает голодание. По времени
            записей кормления.
          </p>
          <details>
            <summary>Таблица по дням</summary>
            <div className={styles.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Съедено, ккал</th>
                    <th>Цель, ккал</th>
                    <th>Ожидает, ккал</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.days.map((day) => (
                    <tr key={day.date}>
                      <td>{day.date}</td>
                      <td>
                        {day.foodCount > day.pendingCount
                          ? number(day.eatenKcal)
                          : day.foodCount
                            ? 'Нет подтверждений'
                            : 'Нет записей'}
                      </td>
                      <td>{number(day.targetKcal)}</td>
                      <td>{day.pendingCount ? `до ${number(day.pendingKcal)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section className={styles.card}>
          <h2>Все записи</h2>
          {!forms.timeline().length && (
            <p className={styles.hint}>Здесь появятся кормления, замены воды и измерения веса.</p>
          )}
          <ul className={styles.records}>
            {forms.timeline().map((item) => (
              <li key={`${item.kind}:${item.record.id}`} className={styles.historyRecord}>
                <time>{stamp(item.record.occurredAt, zone)}</time>
                {item.kind === 'food' ? (
                  <>
                    <strong>{item.record.snapshot.name}</strong>
                    <span>
                      {item.record.mode === 'eaten' ? 'Съедено' : 'Выдано'}{' '}
                      {number(item.record.grams)} г
                      {item.record.remainingGrams !== null
                        ? ` · остаток ${number(item.record.remainingGrams)} г`
                        : ''}
                    </span>
                    <RecordActions
                      name={`кормление ${item.record.snapshot.name}`}
                      edit={() => forms.openFood(item.record)}
                      remove={() => forms.deletion.set({ entity: 'food', id: item.record.id })}
                    />
                  </>
                ) : item.kind === 'water' ? (
                  <>
                    <strong>{item.record.kind === 'replace' ? 'Замена воды' : 'Долив воды'}</strong>
                    <span>
                      Налили {number(item.record.addedMl)} мл · осталось{' '}
                      {number(item.record.remainingMl)} мл
                    </span>
                    <RecordActions
                      name="запись о воде"
                      edit={() => forms.openWater(item.record)}
                      remove={() => forms.deletion.set({ entity: 'water', id: item.record.id })}
                    />
                  </>
                ) : (
                  <>
                    <strong>Вес {number(item.record.kilograms, 2)} кг</strong>
                    <span>{item.record.note}</span>
                    <RecordActions
                      name="измерение веса"
                      edit={() => forms.openWeight(item.record)}
                      remove={() => forms.deletion.set({ entity: 'weight', id: item.record.id })}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
          {forms.timeline().length >= forms.historyLimit() && (
            <button
              className={styles.secondary}
              onClick={wrap(() => forms.historyLimit.set((value) => value + 40))}
            >
              Показать ещё
            </button>
          )}
        </section>
      </div>
      <SideCards model={model} forms={forms} />
    </div>
  )
}, 'CatCare.History')

const Catalog = reatomMemo<Models>(
  ({ model, forms }) => (
    <section className={styles.card}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Продукты</h2>
          <p className={styles.hint}>Калорийность с этикетки. Порцию выберете при кормлении.</p>
        </div>
        <button className={styles.primary} onClick={wrap(() => forms.openProduct())}>
          <Plus size={17} />
          Добавить продукт
        </button>
      </div>
      {!model.allProducts().length && (
        <div className={styles.empty}>
          <Utensils size={30} />
          <h3>Что ест ваша кошка?</h3>
          <p>
            Добавьте первый корм: достаточно названия и калорийности. Состав можно заполнить позже.
          </p>
        </div>
      )}
      <ul className={styles.products}>
        {model.allProducts().map((product) => (
          <li key={product.id} data-archived={product.archived}>
            <div>
              <strong>{product.name}</strong>
              <p className={styles.hint}>
                {productKinds[product.kind]} · {number(product.nutrition.kcalPer100g)} ккал / 100 г
                {product.archived ? ' · В архиве' : ''}
              </p>
              <p className={styles.fine}>
                {product.completeness === 'complete'
                  ? 'Полнорационный'
                  : product.completeness === 'complementary'
                    ? 'Дополнительный'
                    : 'Назначение не указано'}
                {product.defaultPortionGrams
                  ? ` · обычная порция ${number(product.defaultPortionGrams)} г`
                  : ''}
              </p>
            </div>
            <div className={styles.productActions}>
              <button className={styles.secondary} onClick={wrap(() => forms.openProduct(product))}>
                Изменить
              </button>
              <button
                className={styles.textButton}
                disabled={model.mutationPending()}
                onClick={wrap(() => void model.archiveProduct(product.id, !product.archived))}
              >
                {product.archived ? 'Вернуть' : 'В архив'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className={styles.fine}>
        Изменения продукта применяются к новым кормлениям. Исторические записи сохраняют свой
        состав.
      </p>
    </section>
  ),
  'CatCare.Catalog',
)

const Profile = reatomMemo<Models>(
  ({ model, forms }) => (
    <div className={styles.contentGrid}>
      <section className={styles.card}>
        <div className={styles.sectionHeading}>
          <h2>{model.profile().name}</h2>
          <button className={styles.secondary} onClick={wrap(() => forms.openProfile())}>
            Изменить профиль
          </button>
        </div>
        <dl className={styles.profileDetails}>
          <dt>Дата рождения</dt>
          <dd>{model.profile().birthDate ?? 'Не указана'}</dd>
          <dt>Стерилизация</dt>
          <dd>
            {model.profile().neutered === null
              ? 'Не указано'
              : model.profile().neutered
                ? 'Да'
                : 'Нет'}
          </dd>
          <dt>Упитанность BCS</dt>
          <dd>
            {model.profile().bodyConditionScore
              ? `${model.profile().bodyConditionScore} / 9`
              : 'Не указана'}
          </dd>
          <dt>Часовой пояс</dt>
          <dd>{model.profile().timeZone}</dd>
          <dt>Суточная цель</dt>
          <dd>
            {model.profile().calorieTarget
              ? `${number(model.profile().calorieTarget?.kcal ?? null)} ккал`
              : 'Не задана'}
          </dd>
        </dl>
        <p className={styles.hint}>
          Калории — ориентир для наблюдения. Полнорационность, динамика веса и упитанность важнее
          точного совпадения с расчётом.
        </p>
      </section>
      <section className={styles.card}>
        <h3>Как читать дневник</h3>
        <p>
          Записывайте съеденное или взвешивайте остаток выданной порции. Для воды измеряйте объём до
          замены.
        </p>
        <p className={styles.hint}>
          Лакомства и дополнительное питание желательно удерживать в пределах 10% суточной энергии.
          Изменение аппетита, питья или веса обсудите с ветеринарным врачом. Если кошка не ест около
          суток, свяжитесь с ним без ожидания графика.
        </p>
        <details>
          <summary>Расчёты и источники</summary>
          <p className={styles.hint}>
            Начальный ориентир для здоровой взрослой кошки: RER = 70 × вес(кг)⁰·⁷⁵, множитель 1,2
            после стерилизации или 1,4 без неё. Для котят, пожилых кошек и коррекции веса нужна
            индивидуальная цель. БЖУ с разных этикеток могут быть неполными.
          </p>
          <ul className={styles.sources}>
            {CAT_CARE_SOURCES.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                  <ArrowUpRight size={13} />
                </a>
              </li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  ),
  'CatCare.Profile',
)

export const CatCare = reatomMemo(() => {
  const { tier, instanceId, api, storage } = useWidgetContext<CatCareEvents>()
  const { model, forms } = catCareInstance(instanceId, () => {
    const model = createCatCareModel({ storage, api, timer: getServerTime() })
    return { model, forms: createCatCareForms(model) }
  })()
  const chrome = useWidgetChrome()
  const fullscreen = tier === 'fullscreen'
  const compact = tier === 'tiny' || tier === 'compact'
  const open = (kind: 'food' | 'water' | 'weight' | 'profile') => {
    ;({
      food: forms.openFood,
      water: forms.openWater,
      weight: forms.openWeight,
      profile: forms.openProfile,
    })[kind]()
    if (!fullscreen) chrome.onExpand?.()
  }
  const tabs = [
    { id: 'today', label: 'Дневник' },
    { id: 'history', label: 'История и статистика' },
    { id: 'products', label: 'Продукты' },
    { id: 'profile', label: 'Профиль' },
  ] as const
  return (
    <div className={styles.widget} data-tier={tier} data-testid="cat-care-widget">
      <header className={styles.header}>
        <div className={styles.title}>
          <span className={styles.catIcon}>
            <Cat size={20} />
          </span>
          <div>
            <h1>{model.profile().name}</h1>
            {!compact && <span>Питание и забота</span>}
          </div>
        </div>
        <div className={styles.headerActions}>
          {!compact && (
            <button
              className={styles.iconButton}
              aria-label="Настроить профиль кошки"
              onClick={wrap(() => open('profile'))}
            >
              <Settings2 size={17} />
            </button>
          )}
          <WidgetControls placement="inline" {...chrome} />
        </div>
      </header>
      {model.loading() ? (
        <p className={styles.empty} role="status">
          Загружаем дневник…
        </p>
      ) : model.loadError() ? (
        <div className={styles.empty}>
          <p role="alert">{model.loadError()}</p>
          <button className={styles.secondary} onClick={wrap(() => void model.retryLoad())}>
            Повторить загрузку
          </button>
        </div>
      ) : (
        <>
          {fullscreen && (
            <nav className={styles.tabs} aria-label="Разделы дневника">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  aria-current={model.activeTab() === tab.id ? 'page' : undefined}
                  onClick={wrap(() => {
                    forms.close()
                    model.activeTab.set(tab.id)
                  })}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          )}
          <div className={styles.body}>
            {forms.notice() && fullscreen && (
              <p className={styles.notice} role="status">
                {forms.notice()}
              </p>
            )}
            {fullscreen && forms.active() ? (
              <Editor model={model} forms={forms} />
            ) : (
              <>
                {model.mutationError() && fullscreen && (
                  <p className={styles.error} role="alert">
                    {model.mutationError()}
                  </p>
                )}
                {(!fullscreen ||
                  model.activeTab() === 'today' ||
                  model.activeTab() === 'history') && (
                  <div className={styles.dayToolbar}>
                    <div className={styles.dayPicker}>
                      {fullscreen && (
                        <button
                          className={styles.iconButton}
                          aria-label="Предыдущий день"
                          onClick={wrap(() => forms.navigateDay(-1))}
                        >
                          <ChevronLeft size={17} />
                        </button>
                      )}
                      {fullscreen ? (
                        <input
                          aria-label="Дата дневника"
                          type="date"
                          value={model.selectedDate() ?? model.today()}
                          max={model.today()}
                          onChange={wrap((event) => {
                            if (event.target.value)
                              model.selectedDate.set(
                                event.target.value === model.today() ? null : event.target.value,
                              )
                          })}
                        />
                      ) : (
                        <span className={styles.eyebrow}>
                          {model.selectedDate() ? model.selectedDate() : 'Сегодня'}
                        </span>
                      )}
                      {fullscreen && (
                        <button
                          className={styles.iconButton}
                          aria-label="Следующий день"
                          disabled={!model.selectedDate() || model.selectedDate() === model.today()}
                          onClick={wrap(() => forms.navigateDay(1))}
                        >
                          <ChevronRight size={17} />
                        </button>
                      )}
                      {model.selectedDate() && fullscreen && (
                        <button
                          className={styles.textButton}
                          onClick={wrap(() => model.selectedDate.set(null))}
                        >
                          Сегодня
                        </button>
                      )}
                    </div>
                    {fullscreen && <span className={styles.fine}>{model.profile().timeZone}</span>}
                  </div>
                )}
                {!fullscreen ? (
                  <div className={styles.tileContent}>
                    <EnergySummary model={model} compact />
                    <div className={styles.quickActions}>
                      <button className={styles.primary} onClick={wrap(() => open('food'))}>
                        <Plus size={17} />
                        Кормление
                      </button>
                      {!compact && (
                        <>
                          <button className={styles.secondary} onClick={wrap(() => open('water'))}>
                            <Droplets size={17} />
                            Вода
                          </button>
                          <button className={styles.secondary} onClick={wrap(() => open('weight'))}>
                            <Scale size={17} />
                            Вес
                          </button>
                        </>
                      )}
                    </div>
                    {!compact && (
                      <>
                        <ul className={styles.records}>
                          {forms
                            .dayFoods()
                            .slice(0, 2)
                            .map((record) => (
                              <FoodRow
                                key={record.id}
                                record={record}
                                model={model}
                                forms={forms}
                                compact
                              />
                            ))}
                        </ul>
                        <button className={styles.textButton} onClick={chrome.onExpand}>
                          Открыть дневник <ArrowUpRight size={15} />
                        </button>
                      </>
                    )}
                  </div>
                ) : model.activeTab() === 'today' ? (
                  <div className={styles.contentGrid}>
                    <div className={styles.stack}>
                      <div className={styles.card}>
                        <div className={styles.quickActions}>
                          <button className={styles.primary} onClick={wrap(() => open('food'))}>
                            <Plus size={17} />
                            Кормление
                          </button>
                          <button className={styles.secondary} onClick={wrap(() => open('water'))}>
                            <Droplets size={17} />
                            Вода
                          </button>
                          <button className={styles.secondary} onClick={wrap(() => open('weight'))}>
                            <Scale size={17} />
                            Вес
                          </button>
                        </div>
                        <EnergySummary model={model} />
                      </div>
                      <section className={styles.card}>
                        <div className={styles.sectionHeading}>
                          <h2>Кормления</h2>
                          <span className={styles.hint}>{forms.dayFoods().length} записей</span>
                        </div>
                        {forms.dayFoods().length ? (
                          <ul className={styles.records}>
                            {forms.dayFoods().map((record) => (
                              <FoodRow
                                key={record.id}
                                record={record}
                                model={model}
                                forms={forms}
                              />
                            ))}
                          </ul>
                        ) : (
                          <div className={styles.empty}>
                            <Utensils size={28} />
                            <h3>Начнём с первого кормления</h3>
                            <p>Добавьте продукт и порцию. В следующий раз мы вспомним ваш выбор.</p>
                            <button
                              className={styles.textButton}
                              onClick={wrap(() => open('food'))}
                            >
                              Записать кормление <ArrowUpRight size={15} />
                            </button>
                          </div>
                        )}
                      </section>
                    </div>
                    <SideCards model={model} forms={forms} />
                  </div>
                ) : model.activeTab() === 'history' ? (
                  <History model={model} forms={forms} />
                ) : model.activeTab() === 'products' ? (
                  <Catalog model={model} forms={forms} />
                ) : (
                  <Profile model={model} forms={forms} />
                )}
              </>
            )}
            {fullscreen && forms.deletion() && (
              <section
                className={styles.deleteConfirm}
                role="alertdialog"
                aria-label="Удалить запись?"
                aria-describedby={`delete-help-${instanceId}`}
              >
                <h3>Удалить запись?</h3>
                <p id={`delete-help-${instanceId}`}>
                  Итоги и связанные интервалы будут пересчитаны.
                </p>
                <div className={styles.formActions}>
                  <button
                    className={styles.danger}
                    disabled={model.mutationPending()}
                    onClick={wrap(() => void forms.confirmDelete())}
                  >
                    Удалить запись
                  </button>
                  <button
                    className={styles.secondary}
                    disabled={model.mutationPending()}
                    onClick={wrap(() => forms.deletion.set(null))}
                  >
                    Оставить
                  </button>
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  )
}, 'CatCare')
