// Saved logins that cannot renew, and Claude subscription limits that cover one
// model family. Real `opencode serve` with this plugin, a fake provider that
// answers like a Claude subscription (429 with `anthropic-ratelimit-unified-*`),
// and fake OAuth methods whose refresh fails, works, or cannot reach its server.
//
//   fable limited on the only working account ─▶ opus on the same account,
//                                                never the saved login that is dead
//   whole account limited, other login dead  ─▶ wait for the reset on the same account
//   keepalive                                 ─▶ refreshes idle logins, blocks dead ones,
//                                                replaces an active login that died

import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { OpenCode, type OpenCodeClient } from '@opencode/client'
import dedent from 'string-dedent'
import { afterAll, beforeAll, expect, onTestFailed, test } from 'vitest'
import { formatModel, isBlock } from './fallback.ts'
import { FallbackRpc } from './index.ts'

const served: Array<{ model: string; key: string; status: number }> = []
// (model, key) pairs that answer 429 until `until`, with the limit Claude would name.
const limited = new Map<string, { claim: string; until: number }>()

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address !== 'object') return reject(new Error('no port'))
      server.close(() => resolve(address.port))
    })
  })
}

const provider = http.createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => (body += chunk))
  request.on('end', () => {
    const parsed: unknown = JSON.parse(body || '{}')
    const model = parsed && typeof parsed === 'object' && 'model' in parsed ? String(parsed.model) : ''
    const key = (request.headers.authorization ?? '').replace(/^Bearer /, '')
    const limit = limited.get(`${model} ${key}`)
    const rejected = limit !== undefined && limit.until > Date.now()
    served.push({ model, key, status: rejected ? 429 : 200 })
    if (rejected) {
      response.writeHead(429, {
        'content-type': 'application/json',
        'anthropic-ratelimit-unified-status': 'rejected',
        'anthropic-ratelimit-unified-representative-claim': limit.claim,
        'anthropic-ratelimit-unified-reset': String(Math.ceil(limit.until / 1000)),
      })
      response.end(JSON.stringify({ error: { type: 'rate_limit_error', message: "This request would exceed your account's rate limit. Please try again later." } }))
      return
    }
    const chunk = (data: object) => `data: ${JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 0, model, ...data })}\n\n`
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(
      chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: `answered by ${model}` }, finish_reason: null }] }) +
        chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }) +
        'data: [DONE]\n\n',
    )
  })
})

let root = ''
let project = ''
let child: ChildProcess | undefined
let client: OpenCodeClient
const ids: Record<string, string> = {}

beforeAll(async () => {
  const require = createRequire(import.meta.url)
  const providerPort = await freePort()
  await new Promise<void>((resolve) => provider.listen(providerPort, '127.0.0.1', resolve))
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-fallback-health-')))
  project = path.join(root, 'project')
  fs.mkdirSync(project, { recursive: true })
  const shim = path.join(root, 'plugin')
  fs.mkdirSync(shim)
  fs.writeFileSync(path.join(shim, 'index.js'), `export { default } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, 'index.ts')).href)}\n`)
  // Three logins: one whose refresh token is gone, one that renews, one whose token service is down.
  const oauth = path.join(root, 'oauth')
  fs.mkdirSync(oauth)
  fs.writeFileSync(
    path.join(oauth, 'index.js'),
    dedent`
      import { Effect } from 'effect'
      const method = (ctx, id, refresh) => ctx.integration.transform(editor => editor.method.update({
        integrationID: 'gamma',
        method: { id, type: 'oauth', label: id },
        authorize: () => Effect.die('Not used'),
        refresh,
      }))
      export default {
        id: 'oauth-test',
        effect(ctx) {
          return Effect.all([
            method(ctx, 'dead-test', () => Effect.fail(new Error('Claude Pro/Max login failed: token endpoint returned 400: {"error": "invalid_grant", "error_description": "Refresh token expired"}'))),
            method(ctx, 'renewing-test', () => Effect.succeed({ type: 'oauth', methodID: 'renewing-test', access: 'renewed-access', refresh: 'renewed-refresh', expires: Date.now() + 8 * 3_600_000 })),
            method(ctx, 'unreachable-test', () => Effect.fail(new Error('fetch failed'))),
          ])
        },
      }
    `,
  )
  const dirs = { HOME: 'home', XDG_DATA_HOME: 'data', XDG_STATE_HOME: 'state', XDG_CONFIG_HOME: 'config', XDG_CACHE_HOME: 'cache' }
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OPENCODE_') && !key.endsWith('_API_KEY')))
  const env = {
    ...inherited,
    ...Object.fromEntries(Object.entries(dirs).map(([key, dir]) => [key, path.join(root, dir)])),
    OPENCODE_PASSWORD: 'e2e',
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      model: 'gamma/fable',
      providers: {
        gamma: {
          name: 'gamma',
          package: '@opencode/ai/providers/openai-compatible',
          settings: { baseURL: `http://127.0.0.1:${providerPort}/v1` },
          models: { fable: { name: 'fable' }, opus: { name: 'opus' } },
        },
      },
      permissions: [{ action: '*', resource: '*', effect: 'allow' }],
      // Like a setup with one provider: the ranking has no other provider to move to.
      plugins: [oauth, { package: shim, options: { models: ['gamma/opus'] } }],
    }),
  }
  for (const dir of Object.values(dirs)) fs.mkdirSync(path.join(root, dir), { recursive: true })
  const [command = '', ...prefix] = process.env.OPENCODE_E2E_COMMAND?.split(' ') ?? [
    path.join(path.dirname(require.resolve('@opencode/cli/package.json')), 'bin/opencode.exe'),
  ]
  const port = await freePort()
  const log = fs.openSync(path.join(root, 'opencode.log'), 'w')
  child = spawn(command, [...prefix, 'serve', '--port', String(port), '--hostname', '127.0.0.1'], { env, stdio: ['ignore', log, log] })
  const baseUrl = `http://127.0.0.1:${port}`
  const headers = { authorization: `Basic ${Buffer.from('opencode:e2e').toString('base64')}` }
  const deadline = Date.now() + 60_000
  while (!(await fetch(`${baseUrl}/api/info`, { headers }).then((response) => response.ok, () => false))) {
    if (Date.now() > deadline) throw new Error('opencode serve did not start')
    await sleep(100)
  }
  client = OpenCode.make({ baseUrl, headers })

  const expired = Date.now() - 38 * 3_600_000
  // Created oldest first: `main` is created last and starts active.
  ids.dead = (await client.credential.create({ integrationID: 'gamma', label: 'dead', value: { type: 'oauth', methodID: 'dead-test', access: 'dead-access', refresh: 'dead-refresh', expires: expired } })).id
  ids.main = (await client.credential.create({ integrationID: 'gamma', label: 'main', value: { type: 'key', key: 'key-main' } })).id
})

afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child?.once('exit', resolve))
    child.kill('SIGTERM')
    await Promise.race([exited, sleep(5_000).then(() => child?.kill('SIGKILL'))])
  }
  provider.close()
  if (root && !process.env.KEEP_E2E_ROOT) fs.rmSync(root, { recursive: true, force: true })
})

const location = () => ({ location: { directory: project } })
const label = (credentialID: string) => Object.entries(ids).find(([, id]) => id === credentialID)?.[0] ?? credentialID

function logOnFailure() {
  onTestFailed(() => {
    console.error(fs.readFileSync(path.join(root, 'opencode.log'), 'utf8').split('\n').filter((line) => /error|fallback|retry|429|plugin|credential/i.test(line)).slice(-60).join('\n'))
  })
}

async function turn(sessionID: string, text: string) {
  served.length = 0
  await client.session.prompt({ sessionID, text })
  await client.session.wait({ sessionID })
  const session = await client.session.get({ sessionID })
  return { outcome: session.outcome, model: formatModel(session.model!), served: served.map((request) => `${request.model} ${request.key} ${request.status}`) }
}

async function activeLogin() {
  const credentials = await client.credential.list()
  return credentials.filter((credential) => credential.integrationID === 'gamma' && credential.active).map((credential) => credential.label)
}

async function blocks() {
  const result = await client.rpc(FallbackRpc).blocks({}, location())
  const list = result && typeof result === 'object' && 'blocks' in result && Array.isArray(result.blocks) ? result.blocks.filter(isBlock) : []
  return list.map((block) => `${label(block.credentialID)} ${block.modelID} ${block.reason}${block.claim ? ` (${block.claim})` : ''}`).sort()
}

test('a model family limit moves the session to another model of the same account, not to a dead login', async () => {
  logOnFailure()
  limited.set('fable key-main', { claim: 'seven_day_fable', until: Date.now() + 7 * 86_400_000 })
  const session = await client.session.create({ title: 'family limit', location: { directory: project } })
  expect(await turn(session.id, 'hello')).toMatchInlineSnapshot(`
    {
      "model": "gamma/opus#default",
      "outcome": "succeeded",
      "served": [
        "fable key-main 429",
        "opus key-main 200",
      ],
    }
  `)
  expect(await activeLogin()).toEqual(['main'])
  expect(await blocks()).toMatchInlineSnapshot(`
    [
      "dead * auth",
      "main fable quota (seven_day_fable)",
    ]
  `)
}, 20_000)

test('an account limit with only a dead login left waits for the reset on the same account', async () => {
  logOnFailure()
  expect(await client.rpc(FallbackRpc).clear({}, location())).toMatchInlineSnapshot(`
    {
      "removed": 2,
    }
  `)
  limited.set('opus key-main', { claim: 'five_hour', until: Date.now() + 2_500 })
  const session = await client.session.create({ title: 'account limit', location: { directory: project } })
  await client.session.switchModel({ sessionID: session.id, model: { providerID: 'gamma', id: 'opus' } })
  expect(await turn(session.id, 'hello')).toMatchInlineSnapshot(`
    {
      "model": "gamma/opus#default",
      "outcome": "succeeded",
      "served": [
        "opus key-main 429",
        "opus key-main 200",
      ],
    }
  `)
  expect(await activeLogin()).toEqual(['main'])
}, 30_000)

test('keepalive refreshes idle logins, blocks dead ones and replaces an active login that died', async () => {
  logOnFailure()
  const expired = Date.now() - 38 * 3_600_000
  ids.renewing = (await client.credential.create({ integrationID: 'gamma', label: 'renewing', value: { type: 'oauth', methodID: 'renewing-test', access: 'old-access', refresh: 'old-refresh', expires: expired } })).id
  ids.unreachable = (await client.credential.create({ integrationID: 'gamma', label: 'unreachable', value: { type: 'oauth', methodID: 'unreachable-test', access: 'u-access', refresh: 'u-refresh', expires: expired } })).id
  // Creating a login activates it: the dead one is the active login now.
  await client.credential.activate({ credentialID: ids.dead! })
  await client.rpc(FallbackRpc).clear({}, location())
  const startedAt = Date.now()

  const result: unknown = await client.rpc(FallbackRpc).keepalive({}, location())
  const report = result && typeof result === 'object' && 'logins' in result && Array.isArray(result.logins) ? result.logins : []
  expect(report.map((login) => `${login.label}: ${login.state}${login.active ? ' (was active)' : ''}`).sort()).toMatchInlineSnapshot(`
    [
      "dead: dead (was active)",
      "main: ok",
      "renewing: ok",
      "unreachable: unreachable",
    ]
  `)

  // The idle login has a fresh token in OpenCode's credential store.
  const credentials = await client.credential.list()
  const renewed = credentials.find((credential) => credential.id === ids.renewing)
  expect(renewed?.value.type === 'oauth' && { access: renewed.value.access, refresh: renewed.value.refresh, valid: renewed.value.expires > Date.now() + 3_600_000 }).toEqual({
    access: 'renewed-access',
    refresh: 'renewed-refresh',
    valid: true,
  })

  // OpenCode knows which login needs a new sign-in.
  const integration = await client.integration.get({ integrationID: 'gamma', location: { directory: project } })
  expect((integration.data?.connections ?? []).flatMap((connection) => (connection.type === 'credential' && connection.status ? [`${connection.label}: ${connection.status.status}`] : []))).toMatchInlineSnapshot(`
    [
      "dead: needs_auth",
    ]
  `)

  // The dead login was active: a working one took over, so sessions keep running.
  const active = await activeLogin()
  expect(active).toHaveLength(1)
  expect(['main', 'renewing']).toContain(active[0])
  const session = await client.session.create({ title: 'after keepalive', location: { directory: project } })
  await client.session.switchModel({ sessionID: session.id, model: { providerID: 'gamma', id: 'opus' } })
  expect((await turn(session.id, 'hello')).outcome).toBe('succeeded')

  // A dead login is skipped for a day, an unreachable token service is tried again soon.
  const raw: unknown = await client.rpc(FallbackRpc).blocks({}, location())
  const list = raw && typeof raw === 'object' && 'blocks' in raw && Array.isArray(raw.blocks) ? raw.blocks.filter(isBlock) : []
  expect(list.map((block) => `${label(block.credentialID)} ${block.reason} ${Math.round((block.until - startedAt) / 60_000)} min`).sort()).toMatchInlineSnapshot(`
    [
      "dead auth 1440 min",
      "unreachable auth 10 min",
    ]
  `)
}, 30_000)
