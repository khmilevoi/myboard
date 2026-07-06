import type { IncomingMessage, ServerResponse } from 'node:http'

import type Router from 'find-my-way'

import type { ValkeyOps } from '../storage/valkey'
import type { AuthConfig } from './config'
import type { AuthResult } from './handlers'
import {
  getSession,
  postLoginOptions,
  postLoginVerify,
  postLogout,
  postRegisterOptions,
  postRegisterVerify,
} from './handlers'

export type RegisterAuthRoutesDeps = {
  router: Router.Instance<Router.HTTPVersion.V1>
  ops: ValkeyOps
  config: AuthConfig
  now: () => number
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
  const { router, ops, config, now } = deps
  const authDeps = { ops, config, now }

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
}
