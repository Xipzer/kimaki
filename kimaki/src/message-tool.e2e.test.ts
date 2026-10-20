// `kimaki --message-tool`: the plugin gives root sessions a send_message tool
// and the thread shows only its text. The model's plain text stays hidden.

import fs from 'node:fs'
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { BotHandle } from './main.ts'
import { scriptedTurn, seedProjectChannel, startOpencodeTestServer, startTestBot, startTwin, tempDataDir, TEST_USER_ID, waitForFooter, warmUp, type OpencodeTestServer, type TestTwin } from './test/harness.ts'

const dataDir = tempDataDir()
let server: OpencodeTestServer
let twin: TestTwin
let bot: BotHandle

beforeAll(async () => {
  const matchers = scriptedTurn({
    marker: 'message-tool-marker',
    steps: [{ id: 'message-call', tool: 'send_message', input: { text: 'Hello from **send_message**' } }],
    finalText: 'hidden scratchpad text',
  })
  ;[server, twin] = await Promise.all([startOpencodeTestServer({ matchers }), startTwin()])
  await seedProjectChannel({ dataDir, channelId: twin.channelId, guildId: twin.discord.guildId, directory: server.projectDirectory })
  bot = await startTestBot({ dataDir, twin, server, messageTool: true })
  await warmUp({ server })
}, 60_000)

afterAll(async () => {
  await bot?.stop()
  await Promise.all([server?.stop(), twin?.stop()])
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('send_message text shows in Discord, plain text of the same turn does not', async () => {
  await twin.discord.channel(twin.channelId).user(TEST_USER_ID).sendMessage({ content: 'message-tool-marker' })
  const thread = await twin.discord.channel(twin.channelId).waitForThread({ timeout: 8_000 })
  await waitForFooter({ discord: twin.discord, threadId: thread.id })
  expect(await twin.discord.thread(thread.id).text()).toMatchInlineSnapshot(`
    "--- from: user (tommy)
    message-tool-marker
    --- from: assistant (TestBot)
    -# *using deterministic-provider/deterministic-v2 ⋅ build*
    Hello from **send_message**
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
  `)
})
