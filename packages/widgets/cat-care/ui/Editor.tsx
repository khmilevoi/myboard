import { wrap, type FieldAtom } from '@reatom/core'
import { bindField } from '@reatom/react'
import { ArrowLeft, Plus } from 'lucide-react'
import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { CatCareModel } from '../model/cat-care'
import type { CatCareForms } from '../model/forms'
import { number } from './format'

import styles from './cat-care.module.css'

const Field = reatomMemo<{
  field: FieldAtom<string>
  label: string
  labelAction?: ReactNode
  hint?: string
  type?: string
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode']
  children?: ReactNode
  focusTarget?: boolean
  reserveHelp?: boolean
  helpLines?: 1 | 2
  onValue?: (value: string) => void
}>(
  ({
    field,
    label,
    labelAction,
    hint,
    type = 'text',
    inputMode,
    children,
    focusTarget,
    reserveHelp,
    helpLines = 1,
    onValue,
  }) => {
    const id = useId()
    const { error, ...binding } = bindField(field)
    const shared = {
      ...binding,
      id,
      'aria-invalid': !!error,
      'aria-describedby': hint || error ? `${id}-help` : undefined,
      'data-entry-focus': focusTarget || undefined,
      onChange: onValue
        ? wrap(
            (
              event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
            ) => onValue(event.target.value),
          )
        : binding.onChange,
    }
    return (
      <div className={styles.field}>
        <div className={styles.fieldLabel}>
          <label htmlFor={id}>{label}</label>
          {labelAction}
        </div>
        {children ? (
          <select {...shared}>{children}</select>
        ) : type === 'textarea' ? (
          <textarea {...shared} rows={2} />
        ) : (
          <input {...shared} type={type} inputMode={inputMode} />
        )}
        {(hint || error || reserveHelp) && (
          <small
            id={`${id}-help`}
            className={error ? styles.errorText : undefined}
            aria-hidden={(!hint && !error) || undefined}
            style={{ minHeight: `${helpLines * 1.5}em` }}
          >
            {error || hint}
          </small>
        )}
      </div>
    )
  },
  'CatCare.Field',
)

const EntryDetails = reatomMemo<{ forms: CatCareForms; children: ReactNode }>(
  ({ forms, children }) => (
    <details
      className={styles.entryDetails}
      open={forms.detailsOpen()}
      onToggle={wrap((event) => forms.detailsOpen.set(event.currentTarget.open))}
    >
      <summary>Время и подробности</summary>
      <div className={styles.fields}>{children}</div>
    </details>
  ),
  'CatCare.EntryDetails',
)

const estimateReasons: Record<string, string> = {
  missing_weight: 'Добавьте актуальный вес для расчёта.',
  missing_age: 'Укажите дату рождения.',
  missing_neuter_status: 'Укажите статус стерилизации.',
  kitten: 'Котятам нужна индивидуальная норма для роста. Задайте цель с ветеринарным врачом.',
  senior: 'Для кошек старше 10 лет цель лучше подобрать с ветеринарным врачом.',
  body_condition: 'При оценке упитанности вне 4–5/9 цель подбирают индивидуально.',
}

export const Editor = reatomMemo<{ model: CatCareModel; forms: CatCareForms }>(
  ({ model, forms }) => {
    const kind = forms.active()
    const ref = useRef<HTMLDivElement>(null)
    const waterUnitId = useId()
    useEffect(() => {
      ref.current?.scrollIntoView({ block: 'start' })
      const target =
        ref.current?.querySelector<HTMLInputElement>('[data-entry-focus]') ??
        ref.current?.querySelector<HTMLInputElement>('input, select')
      target?.focus({ preventScroll: true })
      if (target instanceof HTMLInputElement && target.type === 'text') target.select()
    }, [kind])
    if (!kind) return null
    const busy = model.mutationPending()
    const names = {
      food: 'Кормление',
      water: 'Вода',
      weight: 'Вес',
      product: 'Продукт',
      profile: 'Профиль кошки',
    }
    const feedback = forms.feedback() || model.mutationError()
    const check = bindField(forms.water.fields.unmeasuredLoss)
    return (
      <div className={styles.editor} ref={ref}>
        <button
          type="button"
          className={styles.textButton}
          onClick={wrap(() => forms.close())}
          disabled={busy}
        >
          <ArrowLeft size={16} />
          Назад к дневнику
        </button>
        <h2>
          {forms.editing() ? 'Изменить: ' : ''}
          {kind === 'water' && !forms.editing() ? 'Добавить воду' : names[kind]}
        </h2>
        <form
          noValidate
          onSubmit={wrap(async (event) => {
            event.preventDefault()
            await wrap(forms.submit())
            requestAnimationFrame(() => {
              ref.current
                ?.querySelector<HTMLElement>('[aria-invalid="true"]')
                ?.focus({ preventScroll: false })
            })
          })}
        >
          <fieldset disabled={busy} className={styles.fields}>
            {kind === 'food' && (
              <>
                <Field
                  field={forms.food.fields.productId}
                  label="Продукт"
                  labelAction={
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={wrap(() => forms.openProduct(null, true))}
                    >
                      <Plus size={14} aria-hidden /> Добавить продукт
                    </button>
                  }
                  reserveHelp
                  focusTarget={!forms.food.fields.productId()}
                  onValue={(id) => forms.chooseProduct(id)}
                >
                  <option value="">Выберите продукт</option>
                  {forms.recentProducts().map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                  <optgroup label="Другие продукты">
                    {model
                      .allProducts()
                      .filter(
                        (item) =>
                          (!item.archived || item.id === forms.food.fields.productId()) &&
                          !forms.recentProducts().some((recent) => recent.id === item.id),
                      )
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                          {item.archived ? ' (в архиве)' : ''}
                        </option>
                      ))}
                  </optgroup>
                </Field>
                {!model.products().length && (
                  <p className={styles.hint}>
                    Добавьте название и калорийность один раз. Потом достаточно выбрать продукт и
                    порцию.
                  </p>
                )}
                <Field
                  field={forms.food.fields.grams}
                  label={forms.food.fields.mode() === 'eaten' ? 'Съедено, г' : 'Выдано, г'}
                  inputMode="decimal"
                  focusTarget={!!forms.food.fields.productId()}
                  reserveHelp
                />
                {forms.foodEnergy() && (
                  <p className={styles.hint}>
                    {forms.foodEnergy()?.pending ? 'Ожидает уточнения: до' : 'Будет учтено'}{' '}
                    <strong>{number(forms.foodEnergy()?.kcal ?? null)} ккал</strong>
                    {!forms.foodEnergy()?.pending && ' съеденного'}
                  </p>
                )}
                <EntryDetails forms={forms}>
                  <Field field={forms.food.fields.mode} label="Что измерили">
                    <option value="eaten">Съедено</option>
                    <option value="offered">Выдано в миску</option>
                  </Field>
                  <Field
                    field={forms.food.fields.occurredAt}
                    label="Когда кормили"
                    type="datetime-local"
                  />
                  {forms.food.fields.mode() === 'offered' && (
                    <div className={styles.inset}>
                      <Field
                        field={forms.food.fields.remainingGrams}
                        label="Осталось, г"
                        inputMode="decimal"
                        hint="Пусто — ещё не измеряли. 0 — съедено всё. До измерения порция не входит в съеденные калории."
                      />
                      {forms.food.fields.remainingGrams().trim() !== '' && (
                        <Field
                          field={forms.food.fields.observedAt}
                          label="Когда измерили остаток"
                          type="datetime-local"
                          hint="Съеденное будет отнесено к дате кормления, точное время неизвестно."
                        />
                      )}
                    </div>
                  )}
                  <Field field={forms.food.fields.note} label="Заметка" type="textarea" />
                  <p className={styles.hint}>Время: {model.profile().timeZone}</p>
                </EntryDetails>
              </>
            )}
            {kind === 'product' && (
              <>
                <Field
                  field={forms.product.fields.name}
                  label="Название продукта"
                  hint="Как на упаковке, чтобы отличать рецептуры"
                />
                <div className={styles.formColumns}>
                  <Field field={forms.product.fields.kind} label="Тип продукта">
                    <option value="dry">Сухой корм</option>
                    <option value="wet">Влажный корм</option>
                    <option value="treat">Лакомство</option>
                    <option value="other">Другое</option>
                  </Field>
                  <Field field={forms.product.fields.completeness} label="Назначение">
                    <option value="unknown">Не указано</option>
                    <option value="complete">Полнорационный</option>
                    <option value="complementary">Дополнительный</option>
                  </Field>
                </div>
                <div className={styles.formColumns}>
                  <Field
                    field={forms.product.fields.energy}
                    label="Калорийность"
                    inputMode="decimal"
                  />
                  <Field field={forms.product.fields.energyUnit} label="Единица калорийности">
                    <option value="100g">ккал на 100 г</option>
                    <option value="kg">ккал на 1 кг</option>
                    <option value="portion">ккал на упаковку / порцию</option>
                  </Field>
                </div>
                {forms.product.fields.energyUnit() === 'portion' && (
                  <Field
                    field={forms.product.fields.packageGrams}
                    label="Масса упаковки / порции, г"
                    inputMode="decimal"
                  />
                )}
                <p className={styles.hint}>
                  Сохраним {number(forms.productEnergy())} ккал / 100 г. Берите энергию с этикетки:
                  из БЖУ её не рассчитываем.
                </p>
                <Field
                  field={forms.product.fields.defaultPortionGrams}
                  label="Обычная порция, г"
                  inputMode="decimal"
                  hint="Необязательно. При следующем кормлении предложим последнюю использованную порцию."
                />
                <details>
                  <summary>Состав с этикетки · необязательно</summary>
                  <p className={styles.hint}>
                    На 100 г продукта, как он продаётся. Не пересчитывайте на сухое вещество. Пустое
                    поле означает «неизвестно».
                  </p>
                  <div className={styles.formColumns}>
                    <Field
                      field={forms.product.fields.protein}
                      label="Белки, г / 100 г"
                      inputMode="decimal"
                    />
                    <Field
                      field={forms.product.fields.fat}
                      label="Жиры, г / 100 г"
                      inputMode="decimal"
                    />
                    <Field
                      field={forms.product.fields.carbs}
                      label="Углеводы, г / 100 г"
                      inputMode="decimal"
                    />
                    <Field
                      field={forms.product.fields.moisture}
                      label="Влажность, %"
                      inputMode="decimal"
                    />
                  </div>
                </details>
              </>
            )}
            {kind === 'water' && (
              <>
                <div className={styles.amountWithUnit}>
                  <Field
                    field={forms.water.fields.addedMl}
                    label={`${forms.water.fields.kind() === 'topup' ? 'Долито' : 'Налито'}, ${forms.waterUnit() === 'g' ? 'г' : 'мл'}`}
                    inputMode="decimal"
                    focusTarget
                    reserveHelp
                  />
                  <div className={styles.unitField}>
                    <label htmlFor={waterUnitId}>Единица</label>
                    <select
                      id={waterUnitId}
                      value={forms.waterUnit()}
                      onChange={wrap((event) =>
                        forms.waterUnit.set(event.target.value as 'ml' | 'g'),
                      )}
                    >
                      <option value="ml">мл</option>
                      <option value="g">г</option>
                    </select>
                  </div>
                </div>
                <p className={styles.hint}>
                  {forms.water.fields.kind() === 'topup'
                    ? 'Долив к воде в миске.'
                    : 'Замена всей воды в миске.'}{' '}
                  Записываем добавленное.
                  {forms.waterUnit() === 'g' && ' Для воды 1 г ≈ 1 мл.'}
                </p>
                <EntryDetails forms={forms}>
                  <Field field={forms.water.fields.kind} label="Действие с водой">
                    <option value="topup">Долили воду</option>
                    <option value="replace">Заменили всю воду</option>
                  </Field>
                  <Field
                    field={forms.water.fields.remainingMl}
                    label="Осталось до замены / долива, мл"
                    inputMode="decimal"
                    hint="Не измеряли — оставьте пустым. Пустая миска — 0. Потребление оцениваем только по измерениям."
                  />
                  <Field
                    field={forms.water.fields.occurredAt}
                    label="Когда меняли / доливали"
                    type="datetime-local"
                  />
                  <Field
                    field={forms.water.fields.discardedMl}
                    label="Известные потери, мл"
                    inputMode="decimal"
                    hint="Вода, пролитая или убранная ранее за интервал. Не включайте остаток, который выливаете при этой замене."
                  />
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={check.checked}
                      onChange={check.onChange}
                      onBlur={check.onBlur}
                      onFocus={check.onFocus}
                    />
                    Были неизмеренные потери
                  </label>
                  <Field field={forms.water.fields.note} label="Заметка" type="textarea" />
                  <p className={styles.hint}>Время: {model.profile().timeZone}</p>
                </EntryDetails>
              </>
            )}
            {kind === 'weight' && (
              <>
                <Field
                  field={forms.weight.fields.kilograms}
                  label="Вес, кг"
                  inputMode="decimal"
                  focusTarget
                  hint="Например, 4,2"
                  reserveHelp
                  helpLines={2}
                />
                <EntryDetails forms={forms}>
                  <Field
                    field={forms.weight.fields.occurredAt}
                    label="Когда взвешивали"
                    type="datetime-local"
                  />
                  <Field field={forms.weight.fields.note} label="Заметка" type="textarea" />
                  <p className={styles.hint}>Время: {model.profile().timeZone}</p>
                </EntryDetails>
              </>
            )}
            {kind === 'profile' && (
              <>
                <Field field={forms.profile.fields.name} label="Имя кошки" />
                <div className={styles.formColumns}>
                  <Field
                    field={forms.profile.fields.birthDate}
                    label="Дата рождения"
                    type="date"
                    hint="Можно оставить неизвестной"
                  />
                  <Field field={forms.profile.fields.neutered} label="Стерилизация">
                    <option value="unknown">Не указано</option>
                    <option value="yes">Да</option>
                    <option value="no">Нет</option>
                  </Field>
                </div>
                <Field
                  field={forms.profile.fields.timeZone}
                  label="Часовой пояс"
                  hint="IANA, например Europe/Warsaw. Определяет границы суток дневника."
                />
                <Field
                  field={forms.profile.fields.bodyConditionScore}
                  label="Упитанность по шкале BCS, 1–9"
                  inputMode="numeric"
                  hint="Необязательно. 4–5 — обычный ориентир нормальной упитанности. Вес сам по себе не заменяет эту оценку."
                />
                <div className={styles.inset}>
                  <h3>Суточная цель</h3>
                  <Field
                    field={forms.profile.fields.target}
                    label="Цель, ккал в сутки"
                    inputMode="decimal"
                    onValue={(value) => forms.changeTarget(value)}
                    hint="Пусто — убрать цель с сегодняшнего дня. Прошлые цели сохранятся."
                  />
                  {forms.profile.fields.target().trim() !== '' && (
                    <Field
                      field={forms.profile.fields.effectiveFrom}
                      label="Цель действует с"
                      type="date"
                    />
                  )}
                  {forms.profileEstimate()?.kcal != null ? (
                    <>
                      <p>
                        Начальный ориентир:{' '}
                        <strong>{number(forms.profileEstimate()?.kcal ?? null, 0)} ккал/сут</strong>
                        .
                      </p>
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={wrap(() => forms.useEstimate())}
                      >
                        Использовать ориентир
                      </button>
                      <p className={styles.hint}>
                        70 × вес⁰·⁷⁵ × {forms.profile.fields.neutered() === 'yes' ? '1,2' : '1,4'}.
                        Для здоровой взрослой кошки; корректируйте по динамике веса и упитанности с
                        врачом. Расчёт станет целью только после сохранения.
                      </p>
                    </>
                  ) : (
                    <p className={styles.hint}>
                      {estimateReasons[forms.profileEstimate()?.reason ?? 'missing_age']}
                    </p>
                  )}
                </div>
              </>
            )}

            {feedback && (
              <p role="alert" className={styles.error}>
                {feedback}
              </p>
            )}
            <div className={styles.formActions}>
              <button type="submit" className={styles.primary}>
                {busy ? 'Сохраняем…' : 'Сохранить'}
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={wrap(() => forms.close())}
              >
                Отмена
              </button>
            </div>
          </fieldset>
        </form>
      </div>
    )
  },
  'CatCare.Editor',
)
