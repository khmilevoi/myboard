import { action, atom, computed, reatomForm, wrap } from '@reatom/core'
import { z } from 'zod'

import { estimateCalorieTarget } from '../domain/nutrition'
import {
  CalendarDateSchema,
  CatProfileSchema,
  FoodRecordSchema,
  ProductSchema,
  TimeZoneSchema,
  WaterRecordSchema,
  WeightRecordSchema,
  type FoodRecord,
  type Product,
  type WaterRecord,
  type WeightRecord,
} from '../domain/schemas'
import { epochToLocalDateTime, getLocalDate, localDateTimeToEpoch } from '../domain/time'
import type { CatCareModel } from './cat-care'

export type EditorKind = 'food' | 'product' | 'water' | 'weight' | 'profile'
type KnownTime = { value: string; timeZone: string; occurredAt: number }

// Keep an empty measurement unknown and support the decimal separator used by
// the Russian UI. Reject exponent/hex input instead of silently coercing it.
export const parseDecimal = (value: string): number | null => {
  const normalized = value.trim().replace(',', '.')
  if (normalized === '') return null
  return /^\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN
}
const decimal = (maximum = 1_000_000) =>
  z
    .string()
    .transform(parseDecimal)
    .pipe(
      z
        .number({ error: 'Введите число' })
        .finite()
        .min(0, 'Число не может быть отрицательным')
        .max(maximum, 'Проверьте значение'),
    )
const positive = (maximum = 1_000_000) =>
  decimal(maximum).pipe(z.number().positive('Введите число больше нуля'))
const optionalDecimal = (maximum = 1_000_000) =>
  z
    .string()
    .transform(parseDecimal)
    .pipe(
      z
        .number({ error: 'Введите число или оставьте поле пустым' })
        .finite()
        .min(0)
        .max(maximum, 'Проверьте значение')
        .nullable(),
    )
const note = z.string().max(2000, 'Не более 2000 символов')
const timeText = z.string().min(1, 'Укажите дату и время')
const formatNumber = (value: number | null) =>
  value === null ? '' : String(value).replace('.', ',')

export function resolveDraftTime(value: string, timeZone: string, known: KnownTime | null) {
  if (known?.value === value && known.timeZone === timeZone) return known.occurredAt
  return localDateTimeToEpoch({ value, timeZone })
}

export function createCatCareForms(model: CatCareModel) {
  const active = atom<EditorKind | null>(null, 'catCare.forms.active')
  const feedback = atom<string | null>(null, 'catCare.forms.feedback')
  const notice = atom<string | null>(null, 'catCare.forms.notice')
  const draftId = atom('', 'catCare.forms.draftId')
  const foodOriginal = atom<FoodRecord | null>(null, 'catCare.forms.foodOriginal')
  const productOriginal = atom<Product | null>(null, 'catCare.forms.productOriginal')
  const editing = atom(false, 'catCare.forms.editing')
  const knownTime = atom<KnownTime | null>(null, 'catCare.forms.knownTime')
  const knownObservation = atom<KnownTime | null>(null, 'catCare.forms.knownObservation')
  const productReturnsToFood = atom(false, 'catCare.forms.productReturnsToFood')
  const savedFoodDraftId = atom('', 'catCare.forms.savedFoodDraftId')
  const targetSource = atom<'manual' | 'estimate'>('manual', 'catCare.forms.targetSource')
  const profileOriginalFields = atom<Record<string, string>>(
    {},
    'catCare.forms.profileOriginalFields',
  )
  const targetTouched = atom(false, 'catCare.forms.targetTouched')
  const historyLimit = atom(40, 'catCare.forms.historyLimit')
  const deletion = atom<{ entity: 'food' | 'water' | 'weight'; id: string } | null>(
    null,
    'catCare.forms.deletion',
  )

  const describeInvalid = (error: z.ZodError) =>
    error.issues.map((issue) => issue.message).join('. ')
  const finish = (message: string) => {
    active.set(null)
    feedback.set(null)
    notice.set(message)
    draftId.set('')
  }
  const captureTime = (occurredAt: number): KnownTime => {
    const timeZone = model.profile().timeZone
    return { occurredAt, timeZone, value: epochToLocalDateTime({ occurredAt, timeZone }) }
  }
  const readTime = (value: string, known = knownTime()) => {
    const result = resolveDraftTime(value, model.profile().timeZone, known)
    if (result instanceof Error) feedback.set(result.publicMessage)
    return result
  }

  const food = reatomForm(
    {
      productId: '',
      occurredAt: '',
      grams: '',
      mode: 'eaten',
      remainingGrams: '',
      observedAt: '',
      note: '',
    },
    {
      name: 'catCare.forms.food',
      validateOnBlur: true,
      schema: z.object({
        productId: z.string().min(1, 'Выберите продукт'),
        occurredAt: timeText,
        grams: positive(),
        mode: z.enum(['eaten', 'offered']),
        remainingGrams: optionalDecimal(),
        observedAt: z.string(),
        note,
      }),
      onSubmit: async (values) => {
        feedback.set(null)
        const occurredAt = readTime(values.occurredAt)
        if (occurredAt instanceof Error) return false
        const original = foodOriginal()
        const product = model.allProducts().find((item) => item.id === values.productId)
        const snapshot = original?.productId === values.productId ? original.snapshot : product
        if (!snapshot) {
          feedback.set('Продукт недоступен. Выберите другой.')
          return false
        }
        const remainingGrams = values.mode === 'offered' ? values.remainingGrams : null
        const observedAt =
          remainingGrams === null ? null : readTime(values.observedAt, knownObservation())
        if (observedAt instanceof Error) return false
        const parsed = FoodRecordSchema.safeParse({
          id: draftId(),
          occurredAt,
          productId: values.productId,
          snapshot: {
            name: snapshot.name,
            kind: snapshot.kind,
            completeness: snapshot.completeness,
            nutrition: snapshot.nutrition,
          },
          grams: values.grams,
          mode: values.mode,
          remainingGrams,
          observedAt,
          note: values.note,
        })
        if (!parsed.success) {
          feedback.set(describeInvalid(parsed.error))
          return false
        }
        const saved = await wrap(model.saveFood(parsed.data))
        if (saved) finish('Кормление сохранено')
        return saved
      },
    },
  )

  const foodEnergy = computed(() => {
    const selected = food.fields.productId()
    const original = foodOriginal()
    const snapshot =
      original?.productId === selected
        ? original.snapshot
        : model.allProducts().find((item) => item.id === selected)
    const grams = parseDecimal(food.fields.grams())
    const remaining =
      food.fields.mode() === 'offered' ? parseDecimal(food.fields.remainingGrams()) : 0
    if (
      !snapshot ||
      grams === null ||
      !Number.isFinite(grams) ||
      (remaining !== null && (!Number.isFinite(remaining) || remaining > grams))
    )
      return null
    return {
      kcal: ((grams - (remaining ?? 0)) * snapshot.nutrition.kcalPer100g) / 100,
      pending: remaining === null,
    }
  }, 'catCare.forms.foodEnergy')
  const product = reatomForm(
    {
      name: '',
      kind: 'dry',
      completeness: 'unknown',
      energy: '',
      energyUnit: '100g',
      packageGrams: '',
      defaultPortionGrams: '',
      protein: '',
      fat: '',
      carbs: '',
      moisture: '',
    },
    {
      name: 'catCare.forms.product',
      validateOnBlur: true,
      schema: z.object({
        name: z.string().trim().min(1, 'Введите название').max(160),
        kind: z.enum(['dry', 'wet', 'treat', 'other']),
        completeness: z.enum(['complete', 'complementary', 'unknown']),
        energy: positive(100_000),
        energyUnit: z.enum(['100g', 'kg', 'portion']),
        packageGrams: optionalDecimal(),
        defaultPortionGrams: optionalDecimal(),
        protein: optionalDecimal(100),
        fat: optionalDecimal(100),
        carbs: optionalDecimal(100),
        moisture: optionalDecimal(100),
      }),
      onSubmit: async (values) => {
        feedback.set(null)
        if (values.energyUnit === 'portion' && !values.packageGrams) {
          feedback.set('Укажите массу упаковки или порции, к которой относятся калории.')
          return false
        }
        const kcalPer100g =
          values.energyUnit === 'kg'
            ? values.energy / 10
            : values.energyUnit === 'portion'
              ? (values.energy * 100) / (values.packageGrams ?? 1)
              : values.energy
        const parsed = ProductSchema.safeParse({
          id: draftId(),
          name: values.name,
          kind: values.kind,
          completeness: values.completeness,
          defaultPortionGrams: values.defaultPortionGrams,
          archived: productOriginal()?.archived ?? false,
          nutrition: {
            kcalPer100g,
            proteinPer100g: values.protein,
            fatPer100g: values.fat,
            carbsPer100g: values.carbs,
            moisturePercent: values.moisture,
          },
        })
        if (!parsed.success) {
          feedback.set(describeInvalid(parsed.error))
          return false
        }
        const saved = await wrap(model.saveProduct(parsed.data))
        if (!saved) return false
        if (productReturnsToFood()) {
          chooseProduct(parsed.data.id, parsed.data)
          draftId.set(savedFoodDraftId())
          active.set('food')
          editing.set(foodOriginal() !== null)
          productReturnsToFood.set(false)
        } else finish('Продукт сохранён')
        return true
      },
    },
  )
  const productEnergy = computed(() => {
    const energy = parseDecimal(product.fields.energy())
    const grams = parseDecimal(product.fields.packageGrams())
    if (energy === null || !Number.isFinite(energy)) return null
    if (product.fields.energyUnit() === 'kg') return energy / 10
    if (product.fields.energyUnit() === 'portion')
      return grams && Number.isFinite(grams) ? (energy * 100) / grams : null
    return energy
  }, 'catCare.forms.productEnergy')

  const water = reatomForm(
    {
      occurredAt: '',
      kind: 'replace',
      addedMl: '',
      remainingMl: '',
      discardedMl: '0',
      unmeasuredLoss: false,
      note: '',
    },
    {
      name: 'catCare.forms.water',
      validateOnBlur: true,
      schema: z.object({
        occurredAt: timeText,
        kind: z.enum(['replace', 'topup']),
        addedMl: decimal(),
        remainingMl: optionalDecimal(),
        discardedMl: decimal(),
        unmeasuredLoss: z.boolean(),
        note,
      }),
      onSubmit: async (values) => {
        feedback.set(null)
        const occurredAt = readTime(values.occurredAt)
        if (occurredAt instanceof Error) return false
        const parsed = WaterRecordSchema.safeParse({ ...values, id: draftId(), occurredAt })
        if (!parsed.success) {
          feedback.set(describeInvalid(parsed.error))
          return false
        }
        const saved = await wrap(model.saveWater(parsed.data))
        if (saved) finish('Запись о воде сохранена')
        return saved
      },
    },
  )
  const weight = reatomForm(
    { occurredAt: '', kilograms: '', note: '' },
    {
      name: 'catCare.forms.weight',
      validateOnBlur: true,
      schema: z.object({
        occurredAt: timeText,
        kilograms: positive().pipe(z.number().max(50, 'Проверьте вес: укажите его в килограммах')),
        note,
      }),
      onSubmit: async (values) => {
        feedback.set(null)
        const occurredAt = readTime(values.occurredAt)
        if (occurredAt instanceof Error) return false
        const parsed = WeightRecordSchema.safeParse({ ...values, id: draftId(), occurredAt })
        if (!parsed.success) {
          feedback.set(describeInvalid(parsed.error))
          return false
        }
        const saved = await wrap(model.saveWeight(parsed.data))
        if (saved) finish('Вес сохранён')
        return saved
      },
    },
  )
  const profile = reatomForm(
    {
      name: '',
      birthDate: '',
      neutered: 'unknown',
      timeZone: 'Europe/Warsaw',
      bodyConditionScore: '',
      target: '',
      effectiveFrom: '',
    },
    {
      name: 'catCare.forms.profile',
      validateOnBlur: true,
      schema: z.object({
        name: z.string().trim().min(1, 'Введите имя').max(80),
        birthDate: z.union([z.literal(''), CalendarDateSchema]),
        neutered: z.enum(['unknown', 'yes', 'no']),
        timeZone: TimeZoneSchema,
        bodyConditionScore: optionalDecimal(9),
        target: optionalDecimal(),
        effectiveFrom: CalendarDateSchema,
      }),
      onSubmit: async (values) => {
        feedback.set(null)
        const original = profileOriginalFields()
        const draft = profile()
        const latest = model.profile()
        const targetChanged =
          targetTouched() ||
          draft.target !== original.target ||
          draft.effectiveFrom !== original.effectiveFrom
        const parsed = CatProfileSchema.safeParse({
          name: draft.name === original.name ? latest.name : values.name,
          birthDate:
            draft.birthDate === original.birthDate ? latest.birthDate : values.birthDate || null,
          neutered:
            draft.neutered === original.neutered
              ? latest.neutered
              : values.neutered === 'unknown'
                ? null
                : values.neutered === 'yes',
          timeZone: draft.timeZone === original.timeZone ? latest.timeZone : values.timeZone,
          bodyConditionScore:
            draft.bodyConditionScore === original.bodyConditionScore
              ? latest.bodyConditionScore
              : values.bodyConditionScore,
          calorieTarget: !targetChanged
            ? latest.calorieTarget
            : values.target === null
              ? null
              : {
                  kcal: values.target,
                  source: targetSource(),
                  effectiveFrom: values.effectiveFrom,
                },
        })
        if (!parsed.success) {
          feedback.set(describeInvalid(parsed.error))
          return false
        }
        const saved = await wrap(model.saveProfile(parsed.data))
        if (saved) finish('Профиль сохранён')
        return saved
      },
    },
  )

  const begin = (kind: EditorKind, original: { id: string } | null) => {
    active.set(kind)
    editing.set(original !== null)
    draftId.set(original?.id ?? crypto.randomUUID())
    feedback.set(null)
    notice.set(null)
    deletion.set(null)
  }
  const chooseProduct = action((id: string, supplied?: Product) => {
    food.fields.productId.set(id)
    if (id) food.fields.productId.validation.clearErrors('schema')
    // An existing record keeps its actual amount; choosing a different product
    // explicitly changes its snapshot at submit, never on catalog updates.
    if (foodOriginal()) return
    const item = supplied ?? model.products().find((candidate) => candidate.id === id)
    const last = model.lastPortions()[id]
    food.fields.grams.set(formatNumber(last?.grams ?? item?.defaultPortionGrams ?? null))
    if ((last?.grams ?? item?.defaultPortionGrams ?? 0) > 0)
      food.fields.grams.validation.clearErrors('schema')
    food.fields.mode.set(last?.mode ?? 'eaten')
  }, 'catCare.forms.chooseProduct')
  const openFood = action((original: FoodRecord | null = null) => {
    begin('food', original)
    foodOriginal.set(original)
    const known = captureTime(original?.occurredAt ?? model.nowMs())
    const observation = captureTime(original?.observedAt ?? model.nowMs())
    knownTime.set(known)
    knownObservation.set(observation)
    food.reset({
      productId: original?.productId ?? '',
      occurredAt: known.value,
      grams: formatNumber(original?.grams ?? null),
      mode: original?.mode ?? 'eaten',
      remainingGrams: formatNumber(original?.remainingGrams ?? null),
      observedAt: observation.value,
      note: original?.note ?? '',
    })
    if (!original) {
      const latest = [...model.foods()]
        .sort((a, b) => b.occurredAt - a.occurredAt)
        .find((record) => model.products().some((item) => item.id === record.productId))
      chooseProduct(latest?.productId ?? model.products()[0]?.id ?? '')
    }
  }, 'catCare.forms.openFood')
  const openProduct = action((original: Product | null = null, returnToFood = false) => {
    if (returnToFood) savedFoodDraftId.set(draftId())
    productReturnsToFood.set(returnToFood)
    begin('product', original)
    productOriginal.set(original)
    product.reset({
      name: original?.name ?? '',
      kind: original?.kind ?? 'dry',
      completeness: original?.completeness ?? 'unknown',
      energy: formatNumber(original?.nutrition.kcalPer100g ?? null),
      energyUnit: '100g',
      packageGrams: '',
      defaultPortionGrams: formatNumber(original?.defaultPortionGrams ?? null),
      protein: formatNumber(original?.nutrition.proteinPer100g ?? null),
      fat: formatNumber(original?.nutrition.fatPer100g ?? null),
      carbs: formatNumber(original?.nutrition.carbsPer100g ?? null),
      moisture: formatNumber(original?.nutrition.moisturePercent ?? null),
    })
  }, 'catCare.forms.openProduct')
  const openWater = action((original: WaterRecord | null = null) => {
    begin('water', original)
    const known = captureTime(original?.occurredAt ?? model.nowMs())
    knownTime.set(known)
    const latest = [...model.water()]
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .find((record) => record.kind === 'replace')
    water.reset({
      occurredAt: known.value,
      kind: original?.kind ?? 'replace',
      addedMl: formatNumber(original?.addedMl ?? latest?.addedMl ?? null),
      remainingMl: formatNumber(original?.remainingMl ?? null),
      discardedMl: formatNumber(original?.discardedMl ?? 0),
      unmeasuredLoss: original?.unmeasuredLoss ?? false,
      note: original?.note ?? '',
    })
  }, 'catCare.forms.openWater')
  const openWeight = action((original: WeightRecord | null = null) => {
    begin('weight', original)
    const known = captureTime(original?.occurredAt ?? model.nowMs())
    knownTime.set(known)
    weight.reset({
      occurredAt: known.value,
      kilograms: formatNumber(original?.kilograms ?? null),
      note: original?.note ?? '',
    })
  }, 'catCare.forms.openWeight')
  const openProfile = action(() => {
    begin('profile', null)
    const current = model.profile()
    targetSource.set(current.calorieTarget?.source ?? 'manual')
    profile.reset({
      name: current.name,
      birthDate: current.birthDate ?? '',
      neutered: current.neutered === null ? 'unknown' : current.neutered ? 'yes' : 'no',
      timeZone: current.timeZone,
      bodyConditionScore: formatNumber(current.bodyConditionScore),
      target: formatNumber(current.calorieTarget?.kcal ?? null),
      effectiveFrom: current.calorieTarget?.effectiveFrom ?? model.today(),
    })
    profileOriginalFields.set({ ...profile() })
    targetTouched.set(false)
  }, 'catCare.forms.openProfile')
  const profileEstimate = computed(() => {
    const values = profile()
    const parsed = CatProfileSchema.safeParse({
      name: values.name,
      birthDate: values.birthDate || null,
      neutered: values.neutered === 'unknown' ? null : values.neutered === 'yes',
      timeZone: values.timeZone,
      bodyConditionScore: parseDecimal(values.bodyConditionScore),
      calorieTarget: null,
    })
    if (!parsed.success) return null
    return estimateCalorieTarget({
      profile: parsed.data,
      latestWeight: model.latestWeight(),
      nowMs: model.nowMs(),
    })
  }, 'catCare.forms.profileEstimate')
  const useEstimate = action(() => {
    const estimate = profileEstimate()
    if (estimate?.kcal === null || estimate?.kcal === undefined) return
    targetTouched.set(true)
    profile.fields.target.set(formatNumber(estimate.kcal))
    profile.fields.effectiveFrom.set(draftToday())
    targetSource.set('estimate')
  }, 'catCare.forms.useEstimate')
  const changeTarget = action((value: string) => {
    targetTouched.set(true)
    profile.fields.target.change(value)
    profile.fields.effectiveFrom.set(draftToday())
    targetSource.set('manual')
  }, 'catCare.forms.changeTarget')
  const draftToday = () => {
    const zone = TimeZoneSchema.safeParse(profile.fields.timeZone())
    return getLocalDate({
      occurredAt: model.nowMs(),
      timeZone: zone.success ? zone.data : model.profile().timeZone,
    })
  }
  const close = action(() => {
    if (model.mutationPending()) return
    if (active() === 'product' && productReturnsToFood()) {
      draftId.set(savedFoodDraftId())
      active.set('food')
      editing.set(foodOriginal() !== null)
      productReturnsToFood.set(false)
      feedback.set(null)
      return
    }
    active.set(null)
    feedback.set(null)
  }, 'catCare.forms.close')
  const submit = action(async () => {
    const kind = active()
    if (!kind || model.mutationPending()) return
    const forms = { food, product, water, weight, profile }
    const result = await wrap(
      forms[kind].submit().catch((error: unknown) => {
        // Reatom's validation boundary rejects invalid forms; the field bindings
        // show the errors and the draft remains intact.
        console.warn('[cat-care] Form validation failed', String(error))
        return false
      }),
    )
    return result
  }, 'catCare.forms.submit')
  const confirmDelete = action(async () => {
    const requested = deletion()
    if (!requested) return false
    const saved = await wrap(model.deleteRecord(requested.entity, requested.id))
    if (saved) {
      deletion.set(null)
      notice.set('Запись удалена')
    }
    return saved
  }, 'catCare.forms.confirmDelete')
  const navigateDay = action((offset: number) => {
    const date = Temporal.PlainDate.from(model.selectedDate() ?? model.today())
      .add({ days: offset })
      .toString()
    model.selectedDate.set(date === model.today() ? null : date)
  }, 'catCare.forms.navigateDay')
  const dayFoods = computed(
    () =>
      model
        .foods()
        .filter(
          (record) =>
            getLocalDate({ occurredAt: record.occurredAt, timeZone: model.profile().timeZone }) ===
            (model.selectedDate() ?? model.today()),
        )
        .sort((a, b) => b.occurredAt - a.occurredAt),
    'catCare.forms.dayFoods',
  )
  const timeline = computed(
    () =>
      [
        ...model.foods().map((record) => ({ kind: 'food' as const, record })),
        ...model.water().map((record) => ({ kind: 'water' as const, record })),
        ...model.weights().map((record) => ({ kind: 'weight' as const, record })),
      ]
        .sort((a, b) => b.record.occurredAt - a.record.occurredAt)
        .slice(0, historyLimit()),
    'catCare.forms.timeline',
  )

  return {
    active,
    feedback,
    notice,
    editing,
    deletion,
    historyLimit,
    food,
    product,
    water,
    weight,
    profile,
    foodOriginal,
    productOriginal,
    productEnergy,
    foodEnergy,
    profileEstimate,
    targetSource,
    chooseProduct,
    openFood,
    openProduct,
    openWater,
    openWeight,
    openProfile,
    close,
    submit,
    confirmDelete,
    navigateDay,
    useEstimate,
    changeTarget,
    dayFoods,
    timeline,
  }
}

export type CatCareForms = ReturnType<typeof createCatCareForms>
