import { PublicWidgetError } from '@shared/widgets/public-error'

// Client/server clocks can briefly differ after a synchronization. The same
// window validates observations and recognizes accepted current weights.
export const MAX_FUTURE_SKEW_MS = 60_000

export function getLocalDate({ occurredAt, timeZone }: { occurredAt: number; timeZone: string }) {
  return Temporal.Instant.fromEpochMilliseconds(occurredAt)
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString()
}

export function epochToLocalDateTime({
  occurredAt,
  timeZone,
}: {
  occurredAt: number
  timeZone: string
}) {
  return Temporal.Instant.fromEpochMilliseconds(occurredAt)
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' })
}

export function localDateTimeToEpoch({
  value,
  timeZone,
}: {
  value: string
  timeZone: string
}): PublicWidgetError | number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) {
    return new PublicWidgetError({
      code: 'cat_care_invalid_time',
      publicMessage: 'Укажите дату и время',
    })
  }
  // This is the single adapter for Temporal's throwing parsing/DST boundary.
  // Expected user-input failures leave the domain as Error values.
  try {
    return Temporal.PlainDateTime.from(value).toZonedDateTime(timeZone, {
      disambiguation: 'reject',
    }).epochMilliseconds
  } catch (cause) {
    return new PublicWidgetError({
      code: 'cat_care_invalid_time',
      publicMessage: 'Проверьте дату, часовой пояс и время перевода часов',
      cause,
    })
  }
}
