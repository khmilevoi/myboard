import type { HardwareSnapshot } from '@shared/hardware/board-api'
import { type HardwareBoardClient, makeHardwareBoardClient } from '@shared/hardware/board-client'
import type { BleAddress } from '@shared/hardware/models'
import { makeFakeOpenEventStream } from '@shared/http/test/fake-event-stream'
import { makeScriptedHttp, type ScriptedStep } from '@shared/http/test/scripted-http'

import { makeHardwareModel } from './hardware-model'

/** Test-only fixtures for the hardware UI. Import from tests only, never from production code. */

// Local noon, so «сегодня» and «вчера» labels agree in every time zone.
export const TEST_NOW = new Date(2026, 10, 27, 12, 0, 0).getTime()
export const TEST_ADDRESS = 'AA:BB:CC:DD:EE:01' as BleAddress

type Gateway = HardwareSnapshot['gateways'][number]
type Hardware = HardwareSnapshot['hardware'][number]

export function makeGateway(over: Partial<Gateway> = {}): Gateway {
  return {
    id: 'g1',
    label: 'Raspberry Pi',
    online: true,
    lastSeenAt: TEST_NOW,
    connectedAt: null,
    adapterPowered: true,
    scan: null,
    bondedNotAdopted: [],
    ...over,
  }
}

export function makeHardware(over: Partial<Hardware> = {}): Hardware {
  return {
    id: 'h1',
    gatewayId: 'g1',
    model: 'beurer-bf950',
    address: TEST_ADDRESS,
    battery: 80,
    lastReadingAt: null,
    profiles: [],
    ...over,
  }
}

export function makeSnapshot(
  gateways: Gateway[] = [],
  hardware: Hardware[] = [],
): HardwareSnapshot {
  return { gateways, hardware }
}

/**
 * A real `HardwareModel` over a scripted HTTP double and a fake event stream. `script` adds
 * responses for the actions a test triggers, `clientOverride` replaces whole client calls; `/api/hardware` serves `snapshot` for every refetch.
 */
export function makeTestHardwareModel(
  snapshot: HardwareSnapshot,
  script: Record<string, ScriptedStep[]> = {},
  clientOverride: Partial<HardwareBoardClient> = {},
) {
  const { http, calls } = makeScriptedHttp({
    '/api/hardware': Array.from({ length: 20 }, () => ({ status: 200, body: snapshot })),
    ...script,
  })
  const { open, streams } = makeFakeOpenEventStream()
  const model = makeHardwareModel({
    client: { ...makeHardwareBoardClient(http), ...clientOverride },
    openEventStream: open,
    now: () => TEST_NOW,
  })
  return { model, calls, streams }
}
