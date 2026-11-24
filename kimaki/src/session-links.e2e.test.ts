import fs from 'node:fs'
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { BotHandle } from './main.ts'
import { runLockRoute } from './lock-routes.ts'
import { send } from './prompt.ts'
import { LINKS_INSTRUCTION_KEY } from './session-links.ts'
import { TEST_USER_ID, seedProjectChannel, startOpencodeTestServer, startTestBot, startTwin, tempDataDir, waitForFooter, warmUp, type OpencodeTestServer, type TestTwin } from './test/harness.ts'

let server: OpencodeTestServer
let twin: TestTwin
let bot: BotHandle
let dataDir: string

beforeAll(async () => {
  dataDir = tempDataDir()
  ;[server, twin] = await Promise.all([startOpencodeTestServer({ matchers: [] }), startTwin()])
  await seedProjectChannel({ dataDir, channelId: twin.channelId, guildId: twin.discord.guildId, directory: server.projectDirectory })
  await warmUp({ server })
  bot = await startTestBot({ dataDir, twin, server })
}, 60_000)

afterAll(async () => {
  await bot?.stop()
  await twin?.stop()
  await server?.stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

async function start(name: string, extra: { parentSessionId?: string; senderSessionId?: string } = {}) {
  const sent = await send(bot, { channelId: twin.channelId, prompt: `Start ${name}`, name, ...extra })
  if (sent instanceof Error || !sent.sessionId) throw sent
  await waitForFooter({ discord: twin.discord, threadId: sent.threadId })
  return { threadId: sent.threadId, sessionId: sent.sessionId }
}

// Linked session IDs in the order the entry shows them.
async function linked(sessionId: string) {
  const entries = await (await server.client()).session.instructions.entry.list({ sessionID: sessionId })
  const entry = entries.find((item) => item.key === LINKS_INSTRUCTION_KEY)
  return [...String(entry?.value ?? '').matchAll(/session (ses_\w+)/g)].map((match) => match[1])
}

test('sends, parents and named threads link sessions both ways; the CLI edits the list', async () => {
  const a = await start('link-a')
  const b = await start('link-b', { parentSessionId: a.sessionId })
  expect(await linked(b.sessionId)).toEqual([a.sessionId])
  expect(await linked(a.sessionId)).toEqual([b.sessionId])

  const c = await start('link-c')
  const prompted = await send(bot, { threadId: c.threadId, prompt: 'Status from link-a', senderSessionId: a.sessionId })
  if (prompted instanceof Error) throw prompted
  await waitForFooter({ discord: twin.discord, threadId: c.threadId, count: 2 })
  expect(await linked(a.sessionId)).toEqual([c.sessionId, b.sessionId])

  // A person names a thread in a prompt: the two sessions are linked.
  await twin.discord.thread(b.threadId).user(TEST_USER_ID).sendMessage({ content: `Ask <#${c.threadId}> about it` })
  await waitForFooter({ discord: twin.discord, threadId: b.threadId, count: 2 })
  expect(await linked(c.sessionId)).toEqual([b.sessionId, a.sessionId])

  const signal = new AbortController().signal
  const removed = await runLockRoute(bot, { route: 'session.links', input: { sessionId: c.sessionId, remove: a.sessionId }, signal })
  if (removed instanceof Error) throw removed
  expect(await linked(c.sessionId)).toEqual([b.sessionId])
  expect(await linked(a.sessionId)).toEqual([b.sessionId])
  const added = await runLockRoute(bot, { route: 'session.links', input: { sessionId: c.sessionId, add: `https://discord.com/channels/${twin.discord.guildId}/${a.threadId}` }, signal })
  if (added instanceof Error) throw added
  expect(await linked(c.sessionId)).toEqual([a.sessionId, b.sessionId])
  expect((added.data as { links: Array<{ source: string }> }).links.map((link) => link.source)).toEqual(['manual', 'mention'])
}, 120_000)

test('a send from another machine links the remote session and names it under the prompt', async () => {
  const d = await start('link-d')
  const remote = { sourceThreadId: '222222222222222222', sourceMachine: 'Projector' }
  // Only the thread is known first: a placeholder, replaced once the session is named.
  const first = await send(bot, { threadId: d.threadId, prompt: 'Hello from the other machine', ...remote })
  if (first instanceof Error) throw first
  await waitForFooter({ discord: twin.discord, threadId: d.threadId, count: 2 })
  expect(await linked(d.sessionId)).toEqual([])
  const second = await send(bot, { threadId: d.threadId, prompt: 'Again', sourceSessionId: 'ses_0123456789abcdefABCDEFghij', ...remote })
  if (second instanceof Error) throw second
  await waitForFooter({ discord: twin.discord, threadId: d.threadId, count: 3 })
  expect(await linked(d.sessionId)).toEqual(['ses_0123456789abcdefABCDEFghij'])
  const listed = await runLockRoute(bot, { route: 'session.links', input: { sessionId: d.sessionId }, signal: new AbortController().signal })
  if (listed instanceof Error) throw listed
  expect((listed.data as { links: Array<{ sessionId: string; machine: string | null }> }).links.map((link) => [link.sessionId, link.machine])).toEqual([['ses_0123456789abcdefABCDEFghij', 'Projector']])
  const entries = await (await server.client()).session.instructions.entry.list({ sessionID: d.sessionId })
  expect(String(entries.find((item) => item.key === LINKS_INSTRUCTION_KEY)?.value)).toContain('thread 222222222222222222 · session ses_0123456789abcdefABCDEFghij · on Projector')
  const messages = await (await server.client()).message.list({ sessionID: d.sessionId, order: 'asc' })
  expect(JSON.stringify(messages.data)).toContain('from Projector · thread 222222222222222222 · session ses_0123456789abcdefABCDEFghij')
}, 120_000)
