import { action, atom, computed, wrap } from '@reatom/core'
import type { AtomLike, Computed } from '@reatom/core'
import { accusative, MONTHS_GENITIVE, nameGender, type NameSex } from '@shared/format/ru'
import type { CatSummary, CatsModel } from 'module-cats'
import type { CatTone } from 'module-cats/domain/cat'
import { latestWeighing } from 'module-cats/domain/cat'
import { DUTY_TIME_ZONE } from 'module-cats/domain/roster'
import { formatAge, formatKg } from 'module-cats/format'
import type { ModuleApiError } from 'widget-runtime'

/** Shown instead of the generic failure when the server refuses to archive the last active cat. */
export const LAST_ACTIVE_CAT_COPY = 'Последнюю кошку в архив не убрать'
export const ARCHIVE_FAILED_COPY = 'Не удалось убрать кошку в архив. Попробуйте ещё раз.'
export const RESTORE_FAILED_COPY = 'Не удалось вернуть кошку. Попробуйте ещё раз.'

/** One row of "Кошки на борде": `line` is "Британская · 3 года · 4,32 кг · Лоток · Офелия". */
export type CatRow = {
  id: string
  name: string
  tone: CatTone
  photoUrl: string | null
  /** The profile's sex, which the dialog's copy declines the name by; null when unset. */
  sex: NameSex | null
  line: string
}

/** One row of "В архиве": `line` is "В архиве с 3 мая 2026 · история сохранена". */
export type ArchivedRow = CatRow

/** What archiving a cat changes for the rest of the board. */
export type ArchiveImpact = {
  /** The cat the cards that had chosen this one show instead; null when there is no other. */
  fallback: { name: string; sex: NameSex | null } | null
  /** The cat's litter title when no other active cat uses it, else null. */
  orphanLitter: string | null
}

export type AllCats = ReturnType<typeof makeAllCats>

/**
 * The archive dialog's title and text (design page 10): "Убрать Бусю в архив?" and "… Карточки,
 * где была выбрана она, покажут Офелию. …", the names in the accusative and the pronoun by the
 * cat's sex.
 */
export function archiveDialogCopy(
  target: Pick<CatRow, 'name' | 'sex'>,
  impact: ArchiveImpact,
): { title: string; text: string } {
  const chosen =
    nameGender(target.name, target.sex) === 'male' ? 'был выбран он' : 'была выбрана она'
  const fallback =
    impact.fallback === null
      ? ''
      : ` Карточки, где ${chosen}, покажут ${accusative(impact.fallback.name, impact.fallback.sex)}.`
  return {
    title: `Убрать ${accusative(target.name, target.sex)} в архив?`,
    text: `${target.name} пропадёт из переключателей.${fallback} История кормлений, веса и лотка сохранится — вернуть можно во вкладке «Все кошки».`,
  }
}

/** "3 мая 2026". */
function formatArchivedOn(archivedAtMs: number): string {
  const date = Temporal.Instant.fromEpochMilliseconds(archivedAtMs)
    .toZonedDateTimeISO(DUTY_TIME_ZONE)
    .toPlainDate()
  return `${date.day} ${MONTHS_GENITIVE[date.month - 1]} ${date.year}`
}

/**
 * The "Все кошки" tab's lists and the archive and restore actions. A row's text needs the cat's
 * profile, weighings and litter, so a row stays out of the list only while the registry loads;
 * a part still loading (the weight) is left out of its line until it arrives.
 */
export function makeAllCats(
  cats: AtomLike<CatsModel | null>,
  today: AtomLike<Temporal.PlainDate | null>,
  name = 'allCats',
) {
  const toRow = (model: CatsModel, summary: CatSummary): CatRow => {
    const cat = model.cat(summary.id)
    const profile = cat.profile()
    const weighings = cat.weighings()
    const latest = weighings === null ? null : latestWeighing(weighings)
    const day = today()
    const birth = profile?.birthDate == null ? null : Temporal.PlainDate.from(profile.birthDate)
    const age = birth === null || day === null ? null : formatAge(birth, day, 'short')
    const litter = model.litters()?.find((candidate) => candidate.id === summary.litterId)
    const line = [
      profile?.breed?.trim().split(/\s+/)[0],
      age,
      latest === null ? null : formatKg(latest.kg),
      litter?.title,
    ]
      .filter((part): part is string => typeof part === 'string' && part !== '')
      .join(' · ')
    return {
      id: summary.id,
      name: summary.name,
      tone: summary.tone,
      photoUrl: summary.avatar,
      sex: profile?.sex ?? null,
      line,
    }
  }

  const active = computed((): CatRow[] | null => {
    const model = cats()
    const list = model?.cats() ?? null
    if (model == null || list === null) return null
    return list.map((summary) => toRow(model, summary))
  }, `${name}.active`)

  const archived = computed((): ArchivedRow[] | null => {
    const model = cats()
    const list = model?.archivedCats() ?? null
    const at = model?.archivedAt() ?? null
    if (model == null || list === null || at === null) return null
    return list.map((summary) => {
      const archivedAt = at[summary.id]
      const line =
        archivedAt === undefined
          ? 'В архиве · история сохранена'
          : `В архиве с ${formatArchivedOn(archivedAt)} · история сохранена`
      return {
        id: summary.id,
        name: summary.name,
        tone: summary.tone,
        photoUrl: summary.avatar,
        sex: model.cat(summary.id).profile()?.sex ?? null,
        line,
      }
    })
  }, `${name}.archived`)

  /** The server never archives the last active cat, so the button is off before it asks. */
  const lastActive = computed(() => (cats()?.cats()?.length ?? 0) <= 1, `${name}.lastActive`)

  const impacts = new Map<string, Computed<ArchiveImpact>>()
  const archiveImpact = (catId: string): Computed<ArchiveImpact> => {
    const known = impacts.get(catId)
    if (known) return known
    const impact = computed((): ArchiveImpact => {
      const list = cats()?.cats() ?? []
      const target = list.find((cat) => cat.id === catId)
      const others = list.filter((cat) => cat.id !== catId)
      const shared = target !== undefined && others.some((cat) => cat.litterId === target.litterId)
      const litter =
        target === undefined || shared
          ? undefined
          : cats()
              ?.litters()
              ?.find((candidate) => candidate.id === target.litterId)
      const first = others[0]
      const fallback =
        first === undefined
          ? null
          : { name: first.name, sex: cats()?.cat(first.id).profile()?.sex ?? null }
      return { fallback, orphanLitter: litter?.title ?? null }
    }, `${name}.archiveImpact#${catId}`)
    impacts.set(catId, impact)
    return impact
  }

  /** The text of the last failed archive or restore; what the dialog or the list shows. */
  const failure = atom<string | null>(null, `${name}.failure`)
  const clearFailure = action(() => {
    failure.set(null)
  }, `${name}.clearFailure`)

  const archive = action(async (catId: string): Promise<ModuleApiError | void> => {
    failure.set(null)
    const model = cats()
    if (model == null) return
    const result = await wrap(model.archiveCat(catId))
    if (result instanceof Error) {
      failure.set(
        'code' in result && result.code === 'last_active_cat'
          ? LAST_ACTIVE_CAT_COPY
          : ARCHIVE_FAILED_COPY,
      )
      return result
    }
  }, `${name}.archive`)

  const restore = action(async (catId: string): Promise<ModuleApiError | void> => {
    failure.set(null)
    const model = cats()
    if (model == null) return
    const result = await wrap(model.restoreCat(catId))
    if (result instanceof Error) {
      failure.set(RESTORE_FAILED_COPY)
      return result
    }
  }, `${name}.restore`)

  return { active, archived, lastActive, archiveImpact, failure, clearFailure, archive, restore }
}
