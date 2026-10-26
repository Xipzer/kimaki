// The mainmast plugin timers (plugin/mainmast.ts) with short windows: an idle
// mainmast is asked for work once and stays silent when it has none, then it is
// compacted when the warming window ends.

import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { BotHandle } from './main.ts'
import {
  TEST_MODEL,
  TEST_USER_ID,
  seedProjectChannel,
  startOpencodeTestServer,
  startTestBot,
  startTwin,
  tempDataDir,
  textParts,
  waitFor,
  waitForFooter,
  warmUp,
  type OpencodeTestServer,
  type TestTwin,
} from './test/harness.ts'

let server: OpencodeTestServer
let twin: TestTwin
let bot: BotHandle
const dataDir = tempDataDir()
// A large context, so the compaction is worth it (plugin/mainmast.ts MIN_COMPACT_TOKENS),
// in a 1M window like Claude Opus: only 12% of it, far below automatic compaction.
const bigUsage = { inputTokens: 120_000, outputTokens: 1, totalTokens: 120_001 }

beforeAll(async () => {
  ;[server, twin] = await Promise.all([
    startOpencodeTestServer({
      models: { [TEST_MODEL]: { name: TEST_MODEL, limit: { context: 1_000_000, output: 32_000 } } },
      matchers: [
        // OpenCode rejects a summary without the template headings.
        { id: 'compaction-summary', priority: 900, when: { latestUserTextIncludes: 'You MUST use this format for your response' }, then: { parts: textParts('## Objective\n- Keep coordinating') } },
        {
          id: 'hello',
          priority: 100,
          when: { latestUserTextIncludes: 'idle-marker' },
          then: { parts: [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Hi there.' }, { type: 'text-end', id: 't' }, { type: 'finish', finishReason: 'stop', usage: bigUsage }] },
        },
        // Nothing to do while the user is away: the IDLE reply that Discord hides.
        {
          id: 'nudge',
          priority: 500,
          when: { latestUserTextIncludes: 'has not replied' },
          then: { parts: [{ type: 'text-start', id: 'n' }, { type: 'text-delta', id: 'n', delta: 'IDLE' }, { type: 'text-end', id: 'n' }, { type: 'finish', finishReason: 'stop', usage: bigUsage }] },
        },
      ],
    }),
    startTwin(),
  ])
  await seedProjectChannel({ dataDir, channelId: twin.channelId, guildId: twin.discord.guildId, directory: server.projectDirectory })
  await warmUp({ server })
  bot = await startTestBot({ dataDir, twin, server, mainmast: true, mainmastTimers: { nudgeMs: 300, compactMs: 1_200 } })
}, 60_000)

afterAll(async () => {
  await bot?.stop()
  await twin?.stop()
  await server?.stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('an idle mainmast is nudged once, stays silent, then gets compacted', async () => {
  const { discord, channelId } = twin
  await discord.channel(channelId).user(TEST_USER_ID).sendMessage({ content: 'Hello idle-marker' })
  await waitForFooter({ discord, threadId: channelId })
  const client = await server.client()
  const root = bot.store.getState().roots[channelId]!
  await waitFor({
    label: 'compaction of the idle mainmast',
    check: async () => (await client.message.list({ sessionID: root, order: 'desc', limit: 10 })).data.some((message) => message.type === 'compaction') || null,
  })

  expect(await discord.channel(channelId).text()).toMatchInlineSnapshot(`
    "--- from: user (tommy)
    Hello idle-marker
    --- from: assistant (TestBot)
    -# *using deterministic-provider/deterministic-v2 ⋅ build*
    Hi there.
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
  `)
  const messages = await client.message.list({ sessionID: root, order: 'asc', limit: 20 })
  // One nudge, answered with nothing, before the compaction.
  expect(messages.data.map((message) => message.type)).toMatchInlineSnapshot(`
    [
      "synthetic",
      "synthetic",
      "user",
      "assistant",
      "idle",
      "synthetic",
      "assistant",
      "idle",
      "compaction",
      "idle",
    ]
  `)
})

// OpenCode reloads the plugin when its files change (every Kimaki build or upgrade).
test('a plugin reload keeps the pending nudge and compaction', async () => {
  const { discord, channelId } = twin
  const client = await server.client()
  const root = bot.store.getState().roots[channelId]!
  const compactions = async () => (await client.message.list({ sessionID: root, order: 'desc', limit: 20 })).data.filter((message) => message.type === 'compaction').length
  expect(await compactions()).toBe(1)
  await discord.channel(channelId).user(TEST_USER_ID).sendMessage({ content: 'Again idle-marker' })
  await waitForFooter({ discord, threadId: channelId, count: 2 })
  fs.appendFileSync(path.join(server.configDir, 'plugins', 'kimaki', 'index.js'), '// reload\n')
  await waitFor({ label: 'compaction after the plugin reload', check: async () => (await compactions()) === 2 || null })

  const messages = await client.message.list({ sessionID: root, order: 'asc', limit: 30 })
  expect(messages.data.slice(10).map((message) => message.type)).toMatchInlineSnapshot(`
    [
      "synthetic",
      "synthetic",
      "user",
      "assistant",
      "idle",
      "synthetic",
      "assistant",
      "idle",
      "compaction",
      "idle",
    ]
  `)
})
