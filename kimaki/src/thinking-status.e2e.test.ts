// Fork: a slow reasoning block shows a live "thinking" line in the thread,
// edited in place and finalized before the answer.

import fs from 'node:fs'
import type { DeterministicMatcher } from 'opencode-deterministic-provider'
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { BotHandle } from './main.ts'
import { TEST_USER_ID, seedProjectChannel, startOpencodeTestServer, startTestBot, startTwin, tempDataDir, waitFor, waitForFooter, warmUp, type OpencodeTestServer, type TestTwin } from './test/harness.ts'

const matchers: DeterministicMatcher[] = [
  {
    id: 'silent-thinking',
    priority: 600,
    when: { latestUserTextIncludes: 'silent-marker' },
    then: {
      parts: [
        { type: 'reasoning-start', id: 'r2' },
        { type: 'reasoning-end', id: 'r2' },
        { type: 'text-start', id: 't2' },
        { type: 'text-delta', id: 't2', delta: 'answer without a summary' },
        { type: 'text-end', id: 't2' },
      ],
      partDelaysMs: [0, 5_000, 0, 0, 0],
    },
  },
  {
    id: 'slow-thinking',
    priority: 500,
    when: { latestUserTextIncludes: 'think-marker' },
    then: {
      parts: [
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', delta: '**Reading the question**\n\n' },
        { type: 'reasoning-delta', id: 'r1', delta: 'Still weighing it.\n\n**Choosing an answer**' },
        { type: 'reasoning-delta', id: 'r1', delta: '\n\nDone.' },
        { type: 'reasoning-end', id: 'r1' },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'answer after thinking' },
        { type: 'text-end', id: 't1' },
      ],
      partDelaysMs: [0, 0, 2_500, 3_000, 2_500, 0, 0, 0],
    },
  },
]

let server: OpencodeTestServer
let twin: TestTwin
let bot: BotHandle
let dataDir: string

beforeAll(async () => {
  dataDir = tempDataDir()
  ;[server, twin] = await Promise.all([startOpencodeTestServer({ matchers }), startTwin()])
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

test('a slow reasoning block shows a live thinking line, finalized before the answer', async () => {
  const { discord, channelId } = twin
  await discord.channel(channelId).user(TEST_USER_ID).sendMessage({ content: 'think-marker please' })
  const thread = await discord.channel(channelId).waitForThread({ timeout: 8_000 })
  const live = await waitFor({
    label: 'live thinking line',
    timeout: 15_000,
    check: async () => (await discord.thread(thread.id).text()).match(/-# thinking · \d+s · .+/)?.[0] ?? null,
  })
  expect(live).toMatch(/^-# thinking · \d+s · (Reading the question|Choosing an answer)$/)
  await waitForFooter({ discord, threadId: thread.id })
  const text = (await discord.thread(thread.id).text()).replace(/thought for \d+s/, 'thought for Ns')
  expect(text).toContain('-# thought for Ns · Choosing an answer')
  expect(text).not.toContain('-# thinking ·')
  expect(text.indexOf('thought for')).toBeLessThan(text.indexOf('answer after thinking'))
})


// Most GPT steps stream no reasoning summary: the line still shows elapsed time.
test('reasoning without a summary still shows elapsed time', async () => {
  const { discord, channelId } = twin
  const before = new Set((await discord.channel(channelId).getThreads()).map((thread) => thread.id))
  await discord.channel(channelId).user(TEST_USER_ID).sendMessage({ content: 'silent-marker please' })
  const thread = await discord.channel(channelId).waitForThread({ timeout: 8_000, predicate: (found) => !before.has(found.id) })
  // The scripted block alone takes 5 s: poll longer than waitFor's 10 s cap on a loaded machine.
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline && !(await discord.thread(thread.id).text()).includes('answer without a summary')) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const text = (await discord.thread(thread.id).text()).replace(/thought for \d+s/, 'thought for Ns')
  expect(text).toContain('-# thought for Ns\n')
  expect(text.indexOf('thought for')).toBeLessThan(text.indexOf('answer without a summary'))
})
