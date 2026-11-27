import type { APIRequestContext } from '@playwright/test'
import {
  HardwareSnapshotSchema,
  type HardwareSnapshot,
  PairResponseSchema,
  CommandAcceptedSchema,
} from '@shared/hardware/board-api'
import type { GatewayEvent } from '@shared/hardware/gateway-protocol'
import {
  PAIRING_PIN_DIGITS,
  type ScaleProfile,
  type ScaleUserIndex,
  SCALE_USER_SLOTS,
} from '@shared/hardware/spike-assumptions'
import { type FakeGateway, type FakeGatewayStream } from '@shared/hardware/testing/fake-gateway'

export {
  makeFakeGateway,
  type FakeGateway,
  type FakeGatewayStream,
} from '@shared/hardware/testing/fake-gateway'
export { PAIRING_PIN_DIGITS } from '@shared/hardware/spike-assumptions'

/** The one scale every hardware spec pairs. */
export const SCALE_ADDRESS = 'AA:BB:CC:DD:EE:01'

/** The health profile the specs save; the scale gets the same three fields. */
export const E2E_HEALTH_PROFILE: ScaleProfile = {
  heightCm: 182,
  birthDate: '1992-03-14',
  sex: 'male',
}

/** Board routes need the session cookie (the request context's) and the CSRF header. */
const BOARD_HEADERS = { 'x-requested-with': 'MyBoard' }

/** A PIN of `PAIRING_PIN_DIGITS` digits: «123456» for six. */
export function e2ePairingPin(): string {
  return Array.from({ length: PAIRING_PIN_DIGITS }, (_, i) => String((i + 1) % 10)).join('')
}

/** The gateway's `scan.result` for the e2e scale. */
export function scaleScanResult(): Extract<GatewayEvent, { type: 'scan.result' }> {
  return {
    type: 'scan.result',
    address: SCALE_ADDRESS,
    name: 'BF950',
    rssi: -60,
    model: 'beurer-bf950',
  }
}

/** Posts gateway events and fails loudly on anything but a 2xx. */
export async function postGatewayEvents(gateway: FakeGateway, events: GatewayEvent[]) {
  const response = await gateway.postEvents(events)
  if (!response.ok) {
    throw new Error(`gateway events failed with ${response.status}: ${await response.text()}`)
  }
}

/** Reads the board's hardware snapshot as the account of `request`. */
export async function readHardwareSnapshot(request: APIRequestContext): Promise<HardwareSnapshot> {
  const response = await request.get('/api/hardware', { headers: BOARD_HEADERS })
  if (!response.ok()) throw new Error(`hardware snapshot failed: ${response.status()}`)
  return HardwareSnapshotSchema.parse(await response.json())
}

async function expectStatus(
  response: Awaited<ReturnType<APIRequestContext['post']>>,
  status: number,
  what: string,
) {
  if (response.status() !== status) {
    throw new Error(`${what} answered ${response.status()}: ${await response.text()}`)
  }
}

/**
 * Mints a gateway code as the account of `request`, registers a fake gateway with it on the
 * worker's test-server (`apiURL`) and opens its stream, so the gateway is online.
 */
export async function connectGatewayViaApi(
  request: APIRequestContext,
  gateway: FakeGateway,
  label = 'Raspberry Pi',
): Promise<FakeGatewayStream> {
  const minted = await request.post('/api/hardware/codes', { headers: BOARD_HEADERS })
  await expectStatus(minted, 201, 'mint gateway code')
  const { code } = (await minted.json()) as { code: string }
  await gateway.register(code, label)
  return gateway.openStream()
}

/**
 * Scans, pairs and bonds the e2e scale on `gateway` through the board routes (as the account of
 * `request`), answering every command on `stream` the way a real gateway would.
 */
export async function pairViaApi(
  request: APIRequestContext,
  gateway: FakeGateway,
  stream: FakeGatewayStream,
): Promise<{ hardwareId: string }> {
  const gatewayId = gateway.gatewayId
  const scan = await request.post(`/api/hardware/gateways/${gatewayId}/scan`, {
    headers: BOARD_HEADERS,
    data: { action: 'start' },
  })
  await expectStatus(scan, 202, 'scan start')
  await stream.nextCommand('scan.start')
  await postGatewayEvents(gateway, [scaleScanResult()])

  const pairing = await request.post(`/api/hardware/gateways/${gatewayId}/pairings`, {
    headers: BOARD_HEADERS,
    data: { address: SCALE_ADDRESS },
  })
  await expectStatus(pairing, 202, 'pairing start')
  const { pairingId } = PairResponseSchema.parse(await pairing.json())
  await stream.nextCommand('pair')
  await postGatewayEvents(gateway, [{ type: 'pairing.progress', pairingId, stage: 'pin_required' }])

  const pin = await request.post(`/api/hardware/pairings/${pairingId}/pin`, {
    headers: BOARD_HEADERS,
    data: { pin: e2ePairingPin() },
  })
  await expectStatus(pin, 202, 'pairing pin')
  await stream.nextCommand('pairing.pin')
  await postGatewayEvents(gateway, [{ type: 'pairing.progress', pairingId, stage: 'bonded' }])

  const snapshot = await readHardwareSnapshot(request)
  const hardware = snapshot.hardware.find(
    (item) => item.gatewayId === gatewayId && item.address === SCALE_ADDRESS,
  )
  if (hardware === undefined) throw new Error('the bonded scale is not in the snapshot')
  return { hardwareId: hardware.id }
}

/**
 * Saves the account's health profile (`profile`, default `E2E_HEALTH_PROFILE`), then creates a new
 * scale profile on `hardwareId` through the board route and answers it on the first free index.
 */
export async function bindProfileViaApi(
  request: APIRequestContext,
  gateway: FakeGateway,
  stream: FakeGatewayStream,
  hardwareId: string,
  profile: ScaleProfile = E2E_HEALTH_PROFILE,
): Promise<{ index: ScaleUserIndex; consentCode: string }> {
  const saved = await request.put('/api/storage/scoped/module/health/account/profile', {
    headers: BOARD_HEADERS,
    data: { value: profile },
  })
  if (!saved.ok()) throw new Error(`health profile save failed: ${saved.status()}`)

  const before = await readHardwareSnapshot(request)
  const taken = new Set(
    before.hardware.find((item) => item.id === hardwareId)?.profiles.map((p) => p.index) ?? [],
  )
  const index = Array.from({ length: SCALE_USER_SLOTS }, (_, i) => i + 1).find(
    (candidate) => !taken.has(candidate),
  )
  if (index === undefined) throw new Error('the scale has no free profile slot')

  const accepted = await request.post(`/api/hardware/items/${hardwareId}/profiles`, {
    headers: BOARD_HEADERS,
    data: { mode: 'create' },
  })
  await expectStatus(accepted, 202, 'profile create')
  const { commandId } = CommandAcceptedSchema.parse(await accepted.json())
  const create = await stream.nextCommand('scaleUser.create')
  if (create.id !== commandId) throw new Error('the gateway got another create command')
  await postGatewayEvents(gateway, [{ type: 'scaleUser.created', commandId, index }])
  return { index, consentCode: create.consentCode }
}
