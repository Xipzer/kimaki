// Fork (mirror.ts): two Kimaki bots on one OpenCode service serve the same sessions,
// like Discord and a Vocorum hub on one machine. Here both are in one twin guild,
// each with its own project channel for the same directory.
import fs from 'node:fs'
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { BotHandle } from './main.ts'
import { TEST_USER_ID, seedProjectChannel, startOpencodeTestServer, startTestBot, startTwin, tempDataDir, waitFor, waitForFooter, warmUp, type OpencodeTestServer, type TestTwin } from './test/harness.ts'

const dataDiscord = tempDataDir()
const dataHub = tempDataDir()
let server: OpencodeTestServer
let twin: TestTwin
let discord: BotHandle
let hub: BotHandle

beforeAll(async () => {
  ;[server, twin] = await Promise.all([startOpencodeTestServer({ matchers: [] }), startTwin()])
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
