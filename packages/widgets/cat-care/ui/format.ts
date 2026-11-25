export const number = (value: number | null, digits = 1) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)
export const time = (value: number, timeZone: string) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit' }).format(value)
export const stamp = (value: number, timeZone: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
export const date = (value: number, timeZone: string) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone, day: 'numeric', month: 'short' }).format(value)
