export const DUTY_TIME_ZONE = 'Europe/Warsaw' as const;
export const BASE_DUTY_DATE = '2026-06-16' as const;
export const DUTY_ROTATION = ['Леша', 'Карина'] as const;

export type DutyPerson = (typeof DUTY_ROTATION)[number];

const DUTY_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: DUTY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DUTY_VISIBLE_DATE_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  timeZone: DUTY_TIME_ZONE,
  dateStyle: 'long',
});

function getDateParts(date: Date): { year: string; month: string; day: string } {
  const parts = DUTY_DATE_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Failed to format Warsaw date parts');
  }

  return { year, month, day };
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);

  if (!year || !month || !day) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(date: Date): string {
  const { year, month, day } = getDateParts(date);
  return `${year}-${month}-${day}`;
}

export function getWarsawDateKey(date: Date): string {
  return formatDateKey(date);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const shiftedDate = parseDateKey(dateKey);
  shiftedDate.setUTCDate(shiftedDate.getUTCDate() + days);
  return formatDateKey(shiftedDate);
}

export function getOfeliaDutyByDateKey(dateKey: string): DutyPerson {
  const baseDate = parseDateKey(BASE_DUTY_DATE);
  const targetDate = parseDateKey(dateKey);
  const diffDays = Math.round((targetDate.getTime() - baseDate.getTime()) / 86_400_000);
  const rotationIndex = ((diffDays % DUTY_ROTATION.length) + DUTY_ROTATION.length) % DUTY_ROTATION.length;

  return DUTY_ROTATION[rotationIndex];
}

export function getOfeliaDuty(date: Date): DutyPerson {
  return getOfeliaDutyByDateKey(getWarsawDateKey(date));
}

export function getOfeliaDutySummary(date: Date): { dateKey: string; today: DutyPerson; tomorrow: DutyPerson } {
  const dateKey = getWarsawDateKey(date);

  return {
    dateKey,
    today: getOfeliaDutyByDateKey(dateKey),
    tomorrow: getOfeliaDutyByDateKey(addDaysToDateKey(dateKey, 1)),
  };
}

export function formatDutyDate(date: Date): string {
  return DUTY_VISIBLE_DATE_FORMATTER.format(date);
}
