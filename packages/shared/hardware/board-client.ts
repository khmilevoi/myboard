import * as errore from 'errore'
import type { z } from 'zod'

import type { HttpLike, HttpResponse, HttpTransportError } from '../http/client'
import {
  type AdoptResponse,
  AdoptResponseSchema,
  type CommandAccepted,
  CommandAcceptedSchema,
  type ConsentCodeResponse,
  ConsentCodeResponseSchema,
  HardwareErrorBodySchema,
  type HardwareErrorCode,
  HardwareErrorCodeSchema,
  type HardwareSnapshot,
  HardwareSnapshotSchema,
  type MintCodeResponse,
  MintCodeResponseSchema,
  type PairResponse,
  PairResponseSchema,
  type ProfileBody,
  type ScanBody,
} from './board-api'
import type { BleAddress } from './models'
import type { PairingPin, ScaleUserIndex } from './spike-assumptions'

/** A non-expected status; `code` is `'unknown'` when the body carries no contract code. */
export class HardwareRequestError extends errore.createTaggedError({
  name: 'HardwareRequestError',
  message: 'Hardware request failed with $status $code',
}) {
  declare status: number
  declare code: HardwareErrorCode | 'unknown'
}

/** The server answered with the expected status but a body that does not match its schema. */
export class HardwareResponseError extends errore.createTaggedError({
  name: 'HardwareResponseError',
  message: 'Hardware response did not match $endpoint',
}) {}

export type HardwareClientError = HardwareRequestError | HardwareResponseError | HttpTransportError

export type HardwareBoardClient = {
  snapshot(): Promise<HardwareClientError | HardwareSnapshot>
  mintCode(): Promise<HardwareClientError | MintCodeResponse>
  revokeGateway(gatewayId: string): Promise<HardwareClientError | void>
  scan(gatewayId: string, action: ScanBody['action']): Promise<HardwareClientError | void>
  pair(gatewayId: string, address: BleAddress): Promise<HardwareClientError | PairResponse>
  submitPin(pairingId: string, pin: PairingPin): Promise<HardwareClientError | void>
  adopt(gatewayId: string, address: BleAddress): Promise<HardwareClientError | AdoptResponse>
  unpair(hardwareId: string): Promise<HardwareClientError | void>
  requestProfile(
    hardwareId: string,
    body: ProfileBody,
  ): Promise<HardwareClientError | CommandAccepted>
  unbind(hardwareId: string, index: ScaleUserIndex): Promise<HardwareClientError | void>
  revealConsentCode(
    hardwareId: string,
    index: ScaleUserIndex,
  ): Promise<HardwareClientError | ConsentCodeResponse>
}

export function isHardwareError(
  error: unknown,
  code: HardwareErrorCode,
): error is HardwareRequestError {
  return error instanceof HardwareRequestError && error.code === code
}

function errorCodeOf(body: unknown): HardwareErrorCode | 'unknown' {
  const parsed = HardwareErrorBodySchema.safeParse(body)
  if (!parsed.success) return 'unknown'
  const code = HardwareErrorCodeSchema.safeParse(parsed.data.error.code)
  return code.success ? code.data : 'unknown'
}

type Method = 'GET' | 'POST' | 'DELETE'
type RequestSpec = { json?: unknown; expect: number }

export function makeHardwareBoardClient(http: HttpLike): HardwareBoardClient {
  async function send(
    method: Method,
    path: string,
    spec: RequestSpec,
  ): Promise<HardwareClientError | HttpResponse> {
    const options = spec.json === undefined ? undefined : { json: spec.json }
    const response =
      method === 'GET'
        ? await http.get(path)
        : method === 'POST'
          ? await http.post(path, options)
          : await http.delete(path)
    if (response instanceof Error) return response
    if (response.status !== spec.expect) {
      return new HardwareRequestError({
        status: response.status,
        code: errorCodeOf(response.body),
      })
    }
    return response
  }

  async function requestJson<S extends z.ZodType>(
    method: Method,
    path: string,
    spec: RequestSpec & { schema: S },
  ): Promise<HardwareClientError | z.infer<S>> {
    const response = await send(method, path, spec)
    if (response instanceof Error) return response
    const parsed = spec.schema.safeParse(response.body)
    if (!parsed.success) return new HardwareResponseError({ endpoint: `${method} ${path}` })
    return parsed.data as z.infer<S>
  }

  async function requestVoid(
    method: Method,
    path: string,
    spec: RequestSpec,
  ): Promise<HardwareClientError | void> {
    const response = await send(method, path, spec)
    if (response instanceof Error) return response
  }

  const enc = encodeURIComponent
  const item = (hardwareId: string) => `/api/hardware/items/${enc(hardwareId)}`
  const profile = (hardwareId: string, index: ScaleUserIndex) =>
    `${item(hardwareId)}/profiles/${enc(String(index))}`

  return {
    snapshot: () =>
      requestJson('GET', '/api/hardware', { expect: 200, schema: HardwareSnapshotSchema }),
    mintCode: () =>
      requestJson('POST', '/api/hardware/codes', { expect: 201, schema: MintCodeResponseSchema }),
    revokeGateway: (gatewayId) =>
      requestVoid('DELETE', `/api/hardware/gateways/${enc(gatewayId)}`, { expect: 204 }),
    scan: (gatewayId, action) =>
      requestVoid('POST', `/api/hardware/gateways/${enc(gatewayId)}/scan`, {
        json: { action },
        expect: 202,
      }),
    pair: (gatewayId, address) =>
      requestJson('POST', `/api/hardware/gateways/${enc(gatewayId)}/pairings`, {
        json: { address },
        expect: 202,
        schema: PairResponseSchema,
      }),
    submitPin: (pairingId, pin) =>
      requestVoid('POST', `/api/hardware/pairings/${enc(pairingId)}/pin`, {
        json: { pin },
        expect: 202,
      }),
    adopt: (gatewayId, address) =>
      requestJson('POST', `/api/hardware/gateways/${enc(gatewayId)}/adopt`, {
        json: { address },
        expect: 200,
        schema: AdoptResponseSchema,
      }),
    unpair: (hardwareId) => requestVoid('DELETE', item(hardwareId), { expect: 204 }),
    requestProfile: (hardwareId, body) =>
      requestJson('POST', `${item(hardwareId)}/profiles`, {
        json: body,
        expect: 202,
        schema: CommandAcceptedSchema,
      }),
    unbind: (hardwareId, index) =>
      requestVoid('DELETE', profile(hardwareId, index), { expect: 204 }),
    revealConsentCode: (hardwareId, index) =>
      requestJson('POST', `${profile(hardwareId, index)}/consent-code`, {
        expect: 200,
        schema: ConsentCodeResponseSchema,
      }),
  }
}
