import type { RuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
import { describe, expect, it } from 'vitest'

import { DuplicateWidgetTypeError, InvalidCronScheduleError, UnknownWidgetTypeError } from './errors'
import { createWidgetServerRegistry, findWidgetServer } from './registry'

const definition: RuntimeWidgetServerDefinition = {
  typeId: 'test-widget',
  schemas: {},
  handlers: {},
  crons: {},
}

describe('widget server registry', () => {
  it('finds a registered definition', () => {
    const registry = createWidgetServerRegistry([definition])
    if (registry instanceof Error) throw registry
    expect(findWidgetServer(registry, 'test-widget')).toBe(definition)
  })

  it('returns an error for an unknown widget', () => {
    const registry = createWidgetServerRegistry([definition])
    if (registry instanceof Error) throw registry
    expect(findWidgetServer(registry, 'missing')).toBeInstanceOf(UnknownWidgetTypeError)
  })

  it('rejects duplicate type IDs', () => {
    expect(createWidgetServerRegistry([definition, definition])).toBeInstanceOf(
      DuplicateWidgetTypeError,
    )
  })
})

function withCron(typeId: string, schedule: string, timeZone: string): RuntimeWidgetServerDefinition {
  return {
    typeId,
    schemas: {},
    handlers: {},
    crons: { nightly: { schedule, timeZone, run: () => undefined } },
  }
}

it('rejects an unparsable cron schedule', () => {
  expect(createWidgetServerRegistry([withCron('broken', 'not a cron', 'Europe/Warsaw')])).toBeInstanceOf(
    InvalidCronScheduleError,
  )
})

it('rejects an unknown time zone', () => {
  expect(createWidgetServerRegistry([withCron('bad-zone', '5 0 * * *', 'Mars/Olympus')])).toBeInstanceOf(
    InvalidCronScheduleError,
  )
})

it('accepts a valid schedule', () => {
  expect(createWidgetServerRegistry([withCron('ok', '5 0 * * *', 'Europe/Warsaw')])).not.toBeInstanceOf(
    Error,
  )
})
