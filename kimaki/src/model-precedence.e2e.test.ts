// Model precedence across surfaces: channel override, session model, global
// default, agent-pinned models, and `kimaki send` with or without --model/--agent.
// A session keeps the model it runs on unless the caller asks for a different one.

import fs from 'node:fs'
import type { DeterministicMatcher } from 'opencode-deterministic-provider'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { setChannelModel, setGlobalModel, switchModel } from './commands/preference-commands.ts'
import type { BotHandle } from './main.ts'
import { send } from './prompt.ts'
import { seedProjectChannel, startOpencodeTestServer, startTestBot, startTwin, tempDataDir, textParts, waitFor, waitForFooter, warmUp, type OpencodeTestServer, type TestTwin } from './test/harness.ts'

const P = 'deterministic-provider'
const matchers: DeterministicMatcher[] = [{ id: 'any', priority: 1, when: { latestUserTextIncludes: 'mp-' }, then: { parts: textParts('ok') } }]

let server: OpencodeTestServer
let twin: TestTwin
let bot: BotHandle
let dataDir: string

beforeAll(async () => {
  dataDir = tempDataDir()
  ;[server, twin] = await Promise.all([
    startOpencodeTestServer({
      matchers,
      models: {
        'deterministic-alt': { name: 'Alt' },
        'deterministic-third': { name: 'Third' },
        'deterministic-thinker': { name: 'Thinker', variants: [{ id: 'low' }, { id: 'high' }] },
      },
      agents: { thinker: { mode: 'primary', model: `${P}/deterministic-thinker#high` } },
    }),
    startTwin(),
  ])
  await seedProjectChannel({ dataDir, channelId: twin.channelId, guildId: twin.discord.guildId, directory: server.projectDirectory })
  await warmUp({ server })
  bot = await startTestBot({ dataDir, twin, server })
})

afterAll(async () => {
  await bot?.stop()
  await twin?.stop()
  await server?.stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

async function modelOf(sessionID: string) {
  const info = await (await server.client()).session.get({ sessionID })
  return `${info.model?.id ?? 'none'}${info.model?.variant ? `#${info.model.variant}` : ''} ${info.agent}`
}

let footers = new Map<string, number>()
async function sendAndWait(input: Parameters<typeof send>[1]) {
  const sent = await send(bot, input)
  if (sent instanceof Error) throw sent
  const threadId = sent.threadId
  const count = (footers.get(threadId) ?? 0) + 1
  footers.set(threadId, count)
  await waitForFooter({ discord: twin.discord, threadId, count })
  const sessionId = sent.sessionId ?? bot.store.getState().roots[threadId]!
  return { threadId, sessionId }
}

test('a session keeps its model unless the caller names one; channel override beats the global default', async () => {
  const g = await setGlobalModel(bot, { model: { providerID: P, id: 'deterministic-v2', variant: null } })
  if (g instanceof Error) throw g
  const c = await setChannelModel(bot, { channelId: twin.channelId, model: { providerID: P, id: 'deterministic-alt', variant: null } })
  if (c instanceof Error) throw c
  const steps: Record<string, string> = {}

  // An agent starts a thread the way the system prompt tells it to: --agent, no --model.
  const { sessionId } = await sendAndWait({ channelId: twin.channelId, prompt: 'mp-1 start', agent: 'build' })
  steps['1 new thread, channel override'] = await modelOf(sessionId)
  await sendAndWait({ sessionId, prompt: 'mp-2 follow-up', agent: 'build' })
  steps['2 agent follow-up, no model'] = await modelOf(sessionId)

  const s = await switchModel(bot, { sessionId, model: { providerID: P, id: 'deterministic-third', variant: null } })
  if (s instanceof Error) throw s
  await waitFor({ label: 'session model switched', check: async () => (await modelOf(sessionId)).startsWith('deterministic-third') })
  await sendAndWait({ sessionId, prompt: 'mp-3 after /model', agent: 'build' })
  steps['3 thread /model, then agent follow-up'] = await modelOf(sessionId)

  await setGlobalModel(bot, { model: { providerID: P, id: 'deterministic-thinker', variant: null } })
  await sendAndWait({ sessionId, prompt: 'mp-4 after global change' })
  steps['4 global default changed, plain follow-up'] = await modelOf(sessionId)

  // An agent with a pinned model, re-asserted on every send like --agent <current_agent>.
  const pinned = await sendAndWait({ channelId: twin.channelId, prompt: 'mp-5 pinned agent', agent: 'thinker' })
  steps['5 new thread with pinned agent (channel override set)'] = await modelOf(pinned.sessionId)
  await switchModel(bot, { sessionId: pinned.sessionId, model: { providerID: P, id: 'deterministic-third', variant: null } })
  await waitFor({ label: 'pinned session switched', check: async () => (await modelOf(pinned.sessionId)).startsWith('deterministic-third') })
  await sendAndWait({ sessionId: pinned.sessionId, prompt: 'mp-6 same agent again', agent: 'thinker' })
  steps['6 thread /model, then same pinned agent re-asserted'] = await modelOf(pinned.sessionId)

  await sendAndWait({ sessionId: pinned.sessionId, prompt: 'mp-7 explicit model', agent: 'thinker', model: `${P}/deterministic-alt` })
  steps['7 explicit --model'] = await modelOf(pinned.sessionId)

  expect(steps).toMatchInlineSnapshot(`
    {
      "1 new thread, channel override": "deterministic-alt#default build",
      "2 agent follow-up, no model": "deterministic-alt#default build",
      "3 thread /model, then agent follow-up": "deterministic-third#default build",
      "4 global default changed, plain follow-up": "deterministic-third#default build",
      "5 new thread with pinned agent (channel override set)": "deterministic-thinker#high thinker",
      "6 thread /model, then same pinned agent re-asserted": "deterministic-third#default thinker",
      "7 explicit --model": "deterministic-alt#default thinker",
    }
  `)
})
