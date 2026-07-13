import type { IncomingMessage, ServerResponse } from 'node:http'

import type Router from 'find-my-way'

import { formatZodError } from '../storage/schemas'
import type { ValkeyOps } from '../storage/valkey'
import { noopAudit, type AuditLogger } from './audit'
import type { AuthConfig } from './config'
import {
  getAccountInfo,
  getDevices,
  getPendingStatus,
  postAddToken,
  postAddTokenOptions,
  postApproveDevice,
  postClaimSession,
  postDenyDevice,
  postDeviceRegisterOptions,
  postDeviceRegisterVerify,
  postRevokeDevice,
} from './device-handlers'
import type { AuthResult } from './handlers'
import {
  getSession,
  postLoginOptions,
  postLoginVerify,
  postLogout,
  postRegisterOptions,
  postRegisterVerify,
} from './handlers'
import { DeviceIdParamsSchema } from './schemas'

export type RegisterAuthRoutesDeps = {
  router: Router.Instance<Router.HTTPVersion.V1>
  ops: ValkeyOps
  config: AuthConfig
  now: () => number
  audit?: AuditLogger
}

function sendAuth(res: ServerResponse, result: AuthResult): void {
  if (result.headers) {
    for (const [name, value] of Object.entries(result.headers)) {
      res.setHeader(name, value)
    }
  }
  if (result.body === undefined) {
    res.writeHead(result.status)
    res.end()
    return
  }
  res.writeHead(result.status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(result.body))
}

export function registerAuthRoutes(deps: RegisterAuthRoutesDeps): void {
  const { router, ops, config, now, audit = noopAudit } = deps
  const authDeps = { ops, config, now, audit }

  router.on(
    'POST',
    '/api/auth/register/options',
    async (req: IncomingMessage, res: ServerResponse) => {
      sendAuth(res, await postRegisterOptions(authDeps, req))
    },
  )

  router.on(
    'POST',
    '/api/auth/register/verify',
    async (req: IncomingMessage, res: ServerResponse) => {
      sendAuth(res, await postRegisterVerify(authDeps, req))
    },
  )

  router.on(
    'POST',
    '/api/auth/login/options',
    async (req: IncomingMessage, res: ServerResponse) => {
      sendAuth(res, await postLoginOptions(authDeps, req))
    },
  )

  router.on('POST', '/api/auth/login/verify', async (req: IncomingMessage, res: ServerResponse) => {
    sendAuth(res, await postLoginVerify(authDeps, req))
  })

  router.on('GET', '/api/auth/session', async (req: IncomingMessage, res: ServerResponse) => {
    sendAuth(res, await getSession(authDeps, req))
  })

  router.on('POST', '/api/auth/logout', async (req: IncomingMessage, res: ServerResponse) => {
    sendAuth(res, await postLogout(authDeps, req))
  })

  router.on(
    'POST',
    '/api/auth/devices/add-token/options',
    async (req: IncomingMessage, res: ServerResponse) => {
      sendAuth(res, await postAddTokenOptions(authDeps, req))
    },
  )

  router.on(
    'POST',
    '/api/auth/devices/add-token',
    async (req: IncomingMessage, res: ServerResponse) => {
      sendAuth(res, await postAddToken(authDeps, req))
    },
  )

  router.on(
    'POST',
    '/api/auth/devices/register/options',
    async (req: IncomingMessage, res: ServerResponse) => {
      sendAuth(res, await postDeviceRegisterOptions(authDeps, req))
    },
  )

  router.on(
    'POST',
    '/api/auth/devices/register/verify',
    async (req: IncomingMessage, res: ServerResponse) => {
      sendAuth(res, await postDeviceRegisterVerify(authDeps, req))
    },
  )

  router.on('GET', '/api/auth/devices', async (req: IncomingMessage, res: ServerResponse) => {
    sendAuth(res, await getDevices(authDeps, req))
  })

  router.on(
    'GET',
    '/api/auth/devices/pending-status',
    async (req: IncomingMessage, res: ServerResponse) => {
      sendAuth(res, await getPendingStatus(authDeps, req))
    },
  )

  router.on(
    'POST',
    '/api/auth/devices/claim-session',
    async (req: IncomingMessage, res: ServerResponse) => {
      sendAuth(res, await postClaimSession(authDeps, req))
    },
  )

  router.on(
    'POST',
    '/api/auth/devices/:credentialId/approve',
    async (req: IncomingMessage, res: ServerResponse, params) => {
      const parsedParams = DeviceIdParamsSchema.safeParse(params)
      if (!parsedParams.success) {
        sendAuth(res, { status: 422, body: formatZodError(parsedParams.error) })
        return
      }
      sendAuth(res, await postApproveDevice(authDeps, req, parsedParams.data))
    },
  )

  router.on(
    'POST',
    '/api/auth/devices/:credentialId/deny',
    async (req: IncomingMessage, res: ServerResponse, params) => {
      const parsedParams = DeviceIdParamsSchema.safeParse(params)
      if (!parsedParams.success) {
        sendAuth(res, { status: 422, body: formatZodError(parsedParams.error) })
        return
      }
      sendAuth(res, await postDenyDevice(authDeps, req, parsedParams.data))
    },
  )

  router.on(
    'POST',
    '/api/auth/devices/:credentialId/revoke',
    async (req: IncomingMessage, res: ServerResponse, params) => {
      const parsedParams = DeviceIdParamsSchema.safeParse(params)
      if (!parsedParams.success) {
        sendAuth(res, { status: 422, body: formatZodError(parsedParams.error) })
        return
      }
      sendAuth(res, await postRevokeDevice(authDeps, req, parsedParams.data))
    },
  )

  router.on('GET', '/api/auth/account', async (req: IncomingMessage, res: ServerResponse) => {
    sendAuth(res, await getAccountInfo(authDeps, req))
  })
}
