import { describe, expect, it } from 'vitest'

import { DEBT_WARNING_THRESHOLD, effectiveDuty, isDebtDay, isOverDebtWarning } from './debt'
import type { DayResolution } from './ledger'

const D = (iso: string) => Temporal.PlainDate.from(iso)

describe('debt selectors', () => {
  it('effectiveDuty / isDebtDay reflect projected debt days', () => {
    const debts = { Леша: 0, Карина: 1 }
    const today = D('2026-06-16')
    expect(isDebtDay(D('2026-06-16'), debts, today)).toBe(true)
    expect(effectiveDuty(D('2026-06-16'), debts, today)).toBe('Карина')
    expect(isDebtDay(D('2026-06-17'), {}, today)).toBe(false)
    expect(effectiveDuty(D('2026-06-17'), {}, today)).toBe('Карина')
  })

  it('effectiveDuty / isDebtDay skip already closed days when projecting debt', () => {
    const debts = { Леша: 0, Карина: 1 }
    const today = D('2026-06-16')
    const resolution = new Map([
      [
        '2026-06-16',
        {
          status: 'closed',
          type: 'went_into_debt',
          actor: 'Леша',
          onBehalfOf: 'Карина',
        } satisfies DayResolution,
      ],
    ])

    expect(isDebtDay(D('2026-06-16'), debts, today, resolution)).toBe(false)
    expect(isDebtDay(D('2026-06-18'), debts, today, resolution)).toBe(true)
    expect(effectiveDuty(D('2026-06-18'), debts, today, resolution)).toBe('Карина')
  })

  it('isOverDebtWarning fires strictly above the threshold', () => {
    expect(DEBT_WARNING_THRESHOLD).toBe(7)
    expect(isOverDebtWarning({ Леша: 7 }, 'Леша')).toBe(false)
    expect(isOverDebtWarning({ Леша: 8 }, 'Леша')).toBe(true)
  })
})
