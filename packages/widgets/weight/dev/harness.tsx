import type { Measurement } from 'module-health/domain/measurement'
import { makeTestHealthModel } from 'module-health/testing'
import { lazy, Suspense } from 'react'
import {
  makeHostRuntime,
  WidgetRuntimeContext,
  type WidgetModules,
  type WidgetTier,
} from 'widget-runtime'
import type { WidgetRuntimeProps } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk'

import client from '../client'

const Widget = lazy(client.loadComponent)

const DEV_ID = 'weight'
const DAY = 86_400_000

const runtime = makeHostRuntime() // bare: no auth anywhere in a harness

// The design's month of readings: one every other morning, 84,4 down to 83,0 кг, plus two older
// ones so the 90-day and year periods have something more to show.
const KGS = [
  84.4, 84.1, 84.3, 84.0, 83.9, 84.2, 83.8, 83.7, 83.9, 83.5, 83.6, 83.4, 83.2, 83.3, 83.0,
]

function reading(index: number, takenAt: number, kg: number): Measurement {
  return {
    id: `dev:${index}`,
    takenAt,
    metrics: { weight: { value: kg, unit: 'kg' } },
    source: { kind: 'hardware', hardwareId: 'dev', model: 'dev' },
  }
}

function seed(): Measurement[] {
  const now = Date.now()
  const recent = KGS.map((kg, index) =>
    reading(index, now - (KGS.length - 1 - index) * 2 * DAY, kg),
  )
  return [reading(100, now - 200 * DAY, 88.1), reading(101, now - 70 * DAY, 85.6), ...recent]
}

// `?readings=none|old|one` previews the empty, no-data-in-period and single states.
function measurementsFor(variant: string | null): Measurement[] {
  if (variant === 'none') return []
  if (variant === 'old') return [reading(0, Date.now() - 60 * DAY, 84.6)]
  if (variant === 'one') return [reading(0, Date.now() - 2 * 60 * 60 * 1000, 83)]
  return seed()
}

const params = new URLSearchParams(window.location.search)
const TIERS: WidgetTier[] = ['tiny', 'compact', 'standard', 'large', 'fullscreen']
const requestedTier = params.get('tier') as WidgetTier | null
const tier: WidgetTier =
  requestedTier && TIERS.includes(requestedTier) ? requestedTier : 'fullscreen'
const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.dataset.theme = theme

// Readings are seeded through the production ingest into in-memory storage, so the harness needs
// no server and shows exactly what the card would show over those keys.
const health = makeTestHealthModel({ measurements: measurementsFor(params.get('readings')) })
const modules = {
  get: async () => {
    const seeded = await health.ready
    if (seeded instanceof Error) console.warn('[harness] seeding failed', seeded)
    return health.model
  },
} as unknown as WidgetModules

export function harnessProps(): WidgetRuntimeProps {
  return {
    instanceId: `dev:${DEV_ID}`,
    typeId: DEV_ID,
    mode: tier === 'fullscreen' ? 'large' : 'small',
    tier,
    theme,
    requestFullscreen: () => {},
    requestClose: () => {},
    requestDelete: () => {},
    reportError: (error) => console.warn('[harness]', error),
    storage: runtime.makeWidgetStorage({ instanceId: `dev:${DEV_ID}`, typeId: DEV_ID }),
    api: runtime.makeWidgetApi({ instanceId: `dev:${DEV_ID}`, typeId: DEV_ID }),
    identity: runtime.identity,
    modules,
  }
}

// The design's card sizes per tier; fullscreen fills the window.
const FRAMES: Record<WidgetTier, { width: string; height: string }> = {
  tiny: { width: '152px', height: '200px' },
  compact: { width: '268px', height: '200px' },
  standard: { width: '400px', height: '300px' },
  large: { width: '1040px', height: '600px' },
  fullscreen: { width: 'calc(100% - 48px)', height: 'calc(100% - 48px)' },
}

export const HarnessApp = reatomMemo(
  () => (
    <div className="harness-frame" style={FRAMES[tier]}>
      <Suspense fallback={null}>
        <WidgetRuntimeContext.Provider value={harnessProps()}>
          <Widget />
        </WidgetRuntimeContext.Provider>
      </Suspense>
    </div>
  ),
  'WeightHarness',
)
