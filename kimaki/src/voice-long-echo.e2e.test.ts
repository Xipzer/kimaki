// Fork: a long voice transcript is echoed in full across several messages,
// both as the first input of a new thread and as a voice note inside a thread.

import fs from 'node:fs'
import path from 'node:path'
import type { DeterministicMatcher } from 'opencode-deterministic-provider'
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { BotHandle } from './main.ts'
import {
  TEST_USER_ID,
  seedProjectChannel,
  startFakeOpenAI,
  startOpencodeTestServer,
  startTestBot,
  startTwin,
  tempDataDir,
  textParts,
  waitForFooter,
  warmUp,
  type FakeOpenAI,
  type OpencodeTestServer,
  type TestTwin,
} from './test/harness.ts'

const words = Array.from({ length: 450 }, (_, i) => `w${i}`)
const transcript = `voice-long ${words.join(' ')} final-word`

const matchers: DeterministicMatcher[] = [
  { id: 'long', priority: 500, when: { latestUserTextIncludes: 'voice-long' }, then: { parts: textParts('long voice ok') } },
]

let server: OpencodeTestServer
let twin: TestTwin
let bot: BotHandle
let openai: FakeOpenAI
let dataDir: string

beforeAll(async () => {
  dataDir = tempDataDir()
  ;[server, twin, openai] = await Promise.all([
    startOpencodeTestServer({ matchers }),
    startTwin(),
    startFakeOpenAI({ result: { transcription: transcript, route: 'steer' } }),
  ])
  await seedProjectChannel({ dataDir, channelId: twin.channelId, guildId: twin.discord.guildId, directory: server.projectDirectory })
  await warmUp({ server })
  process.env['OPENAI_API_KEY'] = 'sk-test-long-echo'
  bot = await startTestBot({ dataDir, twin, server, openaiBaseUrl: openai.baseUrl })
})

afterAll(async () => {
  delete process.env['OPENAI_API_KEY']
  await bot?.stop()
  await twin?.stop()
  await server?.stop()
  await openai?.stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

function echoed(text: string) {
  const body = text.split('\n').filter((line) => !line.startsWith('---') && !line.startsWith('-#') && !line.startsWith('['))
  return body.join(' ')
}

test('a long voice transcript is posted in full, as first input and inside the thread', async () => {
  const ogg = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'voice.ogg'))
  const url = `data:audio/ogg;base64,${ogg.toString('base64')}`
  await twin.discord.channel(twin.channelId).user(TEST_USER_ID).sendVoiceMessage({ url })
  const thread = await twin.discord.channel(twin.channelId).waitForThread({ timeout: 8_000 })
  await waitForFooter({ discord: twin.discord, threadId: thread.id })
  const first = await twin.discord.thread(thread.id).text()
  expect(first).not.toContain('…')
  expect(first.match(/» \*\*tommy:\*\*/g)?.length).toBe(1)
  expect(echoed(first)).toContain('w449 final-word')

  await twin.discord.thread(thread.id).user(TEST_USER_ID).sendVoiceMessage({ url })
  await waitForFooter({ discord: twin.discord, threadId: thread.id, count: 2 })
  const both = await twin.discord.thread(thread.id).text()
  expect(both).not.toContain('…')
  expect(both.match(/» \*\*tommy:\*\*/g)?.length).toBe(2)
  expect(both.match(/w449 final-word/g)?.length).toBe(2)
})
