import { atom, withConnectHook, wrap } from '@reatom/core'
import { getWarsawDateKey } from './ofelia-duty'

const WARSAW_DATE_LOOKAHEAD_MS = 30 * 60 * 60 * 1000
const WARSAW_DATE_CHANGE_CUSHION_MS = 1000

export function findNextWarsawDateChange(now: Date): Date {
  const currentDateKey = getWarsawDateKey(now)
  const start = now.getTime()
  let low = start
  let high = start + WARSAW_DATE_LOOKAHEAD_MS

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    const middleDateKey = getWarsawDateKey(new Date(middle))

    if (middleDateKey === currentDateKey) {
      low = middle
    } else {
      high = middle
    }
  }

  return new Date(high)
}

export const ofeliaNow = atom(() => new Date(), 'ofeliaPoopDuty.now').extend(
  withConnectHook(() => {
    let timeoutId: ReturnType<typeof window.setTimeout> | null = null

    const runUpdate = wrap(() => {
      const now = new Date()
      ofeliaNow.set(now)
      schedule(now)
    })

    const schedule = (now: Date) => {
      const nextDateChange = findNextWarsawDateChange(now)
      const delay = Math.max(
        0,
        nextDateChange.getTime() - Date.now() + WARSAW_DATE_CHANGE_CUSHION_MS,
      )
      timeoutId = window.setTimeout(runUpdate, delay)
    }

    schedule(new Date())

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }),
)
