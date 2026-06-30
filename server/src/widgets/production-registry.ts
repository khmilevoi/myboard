import { toRuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
import { clockServer } from '@widgets/clock/server'
import { ofeliaServer } from '@widgets/ofelia-poop-duty/server'

import { createWidgetServerRegistry } from './registry'

const registry = createWidgetServerRegistry([
  toRuntimeWidgetServerDefinition(clockServer),
  toRuntimeWidgetServerDefinition(ofeliaServer),
])

if (registry instanceof Error) throw registry

export const productionWidgetServerRegistry = registry
