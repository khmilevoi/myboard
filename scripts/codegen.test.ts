import { describe, expect, it } from 'vitest'

import { assignPorts, emitCatalog, emitIcons, emitServerList, type WidgetMeta } from './codegen'

const metas: WidgetMeta[] = [
  {
    dir: 'clock',
    id: 'clock',
    title: 'Часы',
    description: 'Текущее время и дата',
    defaultSize: { w: 3, h: 4, minW: 2, minH: 2 },
    icon: 'Clock',
  },
  {
    dir: 'ofelia-poop-duty',
    id: 'ofelia-poop-duty',
    title: 'Лоток Офелии',
    description: 'Чья сегодня очередь убирать',
    defaultSize: { w: 3, h: 5, minW: 2, minH: 3 },
    icon: 'Cat',
    tiers: { tiny: { minWidthPx: 0, minHeightPx: 0 } },
  },
]

describe('codegen emitters', () => {
  it('inlines catalog metadata and a loadRemote loader per widget', () => {
    const out = emitCatalog(metas)
    expect(out).toContain("import { loadRemote } from '@module-federation/runtime'")
    expect(out).toContain('id: "clock"')
    expect(out).toContain('Лоток Офелии')
    expect(out).toContain('loadRemoteModule("ofelia-poop-duty")')
    expect(out).not.toContain('./ui/Clock')
  })

  it('derives a closed icon union + map from the icons actually used', () => {
    const out = emitIcons(metas)
    expect(out).toContain("import { Cat, Clock } from 'lucide-react'")
    expect(out).toContain("export type WidgetIconName = 'Cat' | 'Clock'")
    expect(out).toContain('export const WIDGET_ICONS: Record<WidgetIconName, LucideIcon> = { Cat, Clock }')
  })

  it('imports each widget server default export into the server list', () => {
    const out = emitServerList(metas)
    expect(out).toContain("import clock from '@widgets/clock/server'")
    expect(out).toContain('toRuntimeWidgetServerDefinition(clock)')
    expect(out).toContain('toRuntimeWidgetServerDefinition(ofeliaPoopDuty)')
  })

  it('keeps existing ports and appends max+1 for new widgets', () => {
    expect(assignPorts(['clock', 'ofelia-poop-duty'], {})).toEqual({
      clock: 5180,
      'ofelia-poop-duty': 5181,
    })
    expect(assignPorts(['aa', 'clock'], { clock: 5180 })).toEqual({ clock: 5180, aa: 5181 })
  })
})
