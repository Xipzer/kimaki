// Fork (mirror.ts): two Kimaki bots on one OpenCode service serve the same sessions,
// like Discord and a Vocorum hub on one machine. Here both are in one twin guild,
// each with its own project channel for the same directory.
import fs from 'node:fs'
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { BotHandle } from './main.ts'
import { send } from './prompt.ts'
import { TEST_USER_ID, slowTextMatcher, seedProjectChannel, startOpencodeTestServer, startTestBot, startTwin, tempDataDir, waitFor, waitForFooter, warmUp, type OpencodeTestServer, type TestTwin } from './test/harness.ts'

const dataDiscord = tempDataDir()
const dataHub = tempDataDir()
let server: OpencodeTestServer
let twin: TestTwin
let discord: BotHandle
let hub: BotHandle

beforeAll(async () => {
  ;[server, twin] = await Promise.all([startOpencodeTestServer({ matchers: [slowTextMatcher({ marker: 'slow-marker', text: 'slow-done', delayMs: 1_500 })] }), startTwin()])
  await seedProjectChannel({ dataDir: dataDiscord, channelId: twin.channelId, guildId: twin.discord.guildId, directory: server.projectDirectory })
  await seedProjectChannel({ dataDir: dataHub, channelId: twin.quietChannelId, guildId: twin.discord.guildId, directory: server.projectDirectory })
  await warmUp({ server })
  ;[discord, hub] = await Promise.all([
    startTestBot({ dataDir: dataDiscord, twin, server, mirror: { home: 'Discord', peerDataDirs: [dataHub] } }),
    startTestBot({ dataDir: dataHub, twin, server, mirror: { home: 'Vocorum', peerDataDirs: [dataDiscord] } }),
  ])
}, 60_000)

afterAll(async () => {
  await Promise.all([discord?.stop(), hub?.stop()])
  await Promise.all([server?.stop(), twin?.stop()])
  fs.rmSync(dataDiscord, { recursive: true, force: true })
  fs.rmSync(dataHub, { recursive: true, force: true })
})

const threadOf = (bot: BotHandle, sessionId: string) => bot.store.getState().sessionThreads[sessionId]

test('a session started on one side is mirrored on the other; a prompt from either side reaches it and shows on both', async () => {
  await twin.discord.channel(twin.channelId).user(TEST_USER_ID).sendMessage({ content: 'Hello from Discord' })
  const discordThread = (await twin.discord.channel(twin.channelId).waitForThread({ timeout: 8_000 })).id
  await waitForFooter({ discord: twin.discord, threadId: discordThread })
  const sessionId = discord.store.getState().roots[discordThread]!
  const hubThread = await waitFor({ label: 'hub thread', timeout: 10_000, check: async () => threadOf(hub, sessionId) })
  expect(hubThread).not.toBe(discordThread)
  await waitForFooter({ discord: twin.discord, threadId: hubThread })

  // Typed on the hub side: the same session answers; Discord shows who typed it, and where.
  await twin.discord.thread(hubThread).user(TEST_USER_ID).sendMessage({ content: 'And hello from Vocorum' })
  await waitForFooter({ discord: twin.discord, threadId: discordThread, count: 2 })
  await waitForFooter({ discord: twin.discord, threadId: hubThread, count: 2 })
  const scrub = (text: string) => text.replaceAll(/\d+(\.\d+)?s\b/g, 'Ns')
  expect(scrub(await twin.discord.thread(discordThread).text())).toMatchInlineSnapshot(`
    "--- from: user (tommy)
    Hello from Discord
    --- from: assistant (TestBot)
    -# *using deterministic-provider/deterministic-v2 ⋅ build*
    ok
    -# *main ⋅ Ns ⋅ deterministic-v2*
    -# » **tommy (Vocorum):** And hello from Vocorum
    ok
    -# *main ⋅ Ns ⋅ deterministic-v2*"
  `)
  expect(scrub(await twin.discord.thread(hubThread).text())).toMatchInlineSnapshot(`
    "--- from: assistant (TestBot)
    -# » **tommy (Discord):** Hello from Discord
    -# *using deterministic-provider/deterministic-v2 ⋅ build*
    ok
    -# *main ⋅ Ns ⋅ deterministic-v2*
    --- from: user (tommy)
    And hello from Vocorum
    --- from: assistant (TestBot)
    ok
    -# *main ⋅ Ns ⋅ deterministic-v2*"
  `)
  // The side that started the session keeps it: the agent's `kimaki` calls go there.
  const info = await (await server.client()).session.get({ sessionID: sessionId })
  expect((info.metadata?.['kimaki'] as { dataDir?: string }).dataDir).toBe(dataDiscord)
}, 120_000)

test('prompts queued on Discord while the session is busy (typed and from the CLI) show in the hub', async () => {
  await twin.discord.channel(twin.channelId).user(TEST_USER_ID).sendMessage({ content: 'Start the queue case' })
  const discordThread = await waitFor({
    label: 'second Discord thread',
    timeout: 10_000,
    check: async () => Object.keys(discord.store.getState().roots).find((id) => id !== Object.keys(discord.store.getState().roots)[0]),
  })
  await waitForFooter({ discord: twin.discord, threadId: discordThread })
  const sessionId = discord.store.getState().roots[discordThread]!
  const hubThread = await waitFor({ label: 'hub thread', timeout: 10_000, check: async () => threadOf(hub, sessionId) })
  await twin.discord.thread(discordThread).user(TEST_USER_ID).sendMessage({ content: 'slow-marker please' })
  await waitFor({ label: 'busy', timeout: 10_000, check: async () => (await twin.discord.thread(hubThread).text()).includes('slow-marker please') })
  await twin.discord.thread(discordThread).user(TEST_USER_ID).sendMessage({ content: 'Then this one. queue' })
  const queued = await send(discord, { threadId: discordThread, prompt: 'And one from the CLI. queue' })
  if (queued instanceof Error) throw queued
  const hubText = await waitFor({
    label: 'queued prompts in the hub',
    timeout: 10_000,
    check: async () => {
      const text = await twin.discord.thread(hubThread).text()
      return text.includes('Then this one') && text.includes('And one from the CLI') && (text.match(/deterministic-v2\*/g) ?? []).length >= 4 ? text : null
    },
  })
  expect(hubText).toContain('» **tommy (Discord):** Then this one')
}, 120_000)
