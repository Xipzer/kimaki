// Local Whisper. A voice note goes as raw Ogg to a standard
// /audio/transcriptions server and lands in the thread. Local only: with an
// OpenAI key configured too, a Local Whisper failure is reported and the audio
// never reaches the cloud transcriber. With fallback on, the cloud one runs next.

import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import type { DeterministicMatcher } from 'opencode-deterministic-provider'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'

import type { LocalWhisper } from './local-whisper.ts'
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

const matchers: DeterministicMatcher[] = [
  { id: 'local', priority: 500, when: { latestUserTextIncludes: 'voice-local' }, then: { parts: textParts('local voice ok') } },
  { id: 'cloud', priority: 500, when: { latestUserTextIncludes: 'voice-cloud' }, then: { parts: textParts('cloud voice ok') } },
]

let server: OpencodeTestServer
let twin: TestTwin
let bot: BotHandle | undefined
let openai: FakeOpenAI
let whisperServer: http.Server
let whisperUrl: string
let dataDir: string
const whisper = { status: 200, requests: [] as Array<{ model: unknown; type: string; header: string }> }
const ogg = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'voice.ogg'))

beforeAll(async () => {
  dataDir = tempDataDir()
  ;[server, twin, openai] = await Promise.all([
    startOpencodeTestServer({ matchers }),
    startTwin(),
    startFakeOpenAI({ result: { transcription: 'From the cloud voice-cloud', route: 'steer' } }),
  ])
  whisperServer = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', async () => {
      const headers = new Headers(Object.entries(request.headers).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : [])))
      const form = await new Request('http://fake/', { method: 'POST', headers, body: Buffer.concat(chunks) }).formData()
      const file = form.get('file') as File
      whisper.requests.push({ model: form.get('model'), type: file.type, header: Buffer.from(await file.arrayBuffer()).subarray(0, 4).toString('ascii') })
      response.statusCode = whisper.status
      response.end(whisper.status === 200 ? JSON.stringify({ text: 'Hello from the local GPU voice-local' }) : 'model loading')
    })
  })
  await new Promise<void>((resolve) => whisperServer.listen(0, '127.0.0.1', resolve))
  whisperUrl = `http://127.0.0.1:${(whisperServer.address() as AddressInfo).port}/v1`
  await seedProjectChannel({ dataDir, channelId: twin.channelId, guildId: twin.discord.guildId, directory: server.projectDirectory })
  await warmUp({ server })
  process.env['OPENAI_API_KEY'] = 'sk-test-local-whisper'
})

afterEach(async () => {
  await bot?.stop()
  bot = undefined
})

afterAll(async () => {
  delete process.env['OPENAI_API_KEY']
  await twin?.stop()
  await server?.stop()
  await openai?.stop()
  await new Promise<void>((resolve) => whisperServer.close(() => resolve()))
  fs.rmSync(dataDir, { recursive: true, force: true })
})

const start = async (localWhisper: Omit<LocalWhisper, 'url'>) => {
  bot = await startTestBot({ dataDir, twin, server, openaiBaseUrl: openai.baseUrl, localWhisper: { url: whisperUrl, ...localWhisper } })
}

const sendVoice = async () => {
  const before = new Set((await twin.discord.channel(twin.channelId).getThreads()).map((thread) => thread.id))
  await twin.discord.channel(twin.channelId).user(TEST_USER_ID).sendVoiceMessage({ url: `data:audio/ogg;base64,${ogg.toString('base64')}` })
  return before
}

test('a voice note is transcribed by Local Whisper, not the cloud, even with an OpenAI key', async () => {
  await start({ model: 'Systran/faster-whisper-large-v3', fallback: false })
  const before = await sendVoice()
  const thread = await twin.discord.channel(twin.channelId).waitForThread({ timeout: 8_000, predicate: (thread) => !before.has(thread.id) })
  await waitForFooter({ discord: twin.discord, threadId: thread.id })
  const text = await twin.discord.thread(thread.id).text()
  expect(text).toContain('» **tommy:** Hello from the local GPU voice-local')
  expect(text).toContain('local voice ok')
  expect(whisper.requests.at(-1)).toEqual({ model: 'Systran/faster-whisper-large-v3', type: 'audio/ogg', header: 'OggS' })
  expect(openai.requests).toHaveLength(0)
})

test('local only: a Local Whisper failure is reported and the audio never goes to the cloud', async () => {
  await start({ model: 'whisper-1', fallback: false })
  whisper.status = 503
  const before = await sendVoice()
  const reply = await twin.discord.channel(twin.channelId).waitForMessage({
    timeout: 8_000,
    predicate: (message) => message.content.includes('Transcription API returned 503'),
  })
  expect(reply.content).toContain('model loading')
  expect((await twin.discord.channel(twin.channelId).getThreads()).filter((thread) => !before.has(thread.id))).toHaveLength(0)
  expect(openai.requests).toHaveLength(0)
})

test('with fallback on, the cloud transcriber runs after a Local Whisper failure', async () => {
  await start({ model: 'whisper-1', fallback: true })
  whisper.status = 503
  const before = await sendVoice()
  const thread = await twin.discord.channel(twin.channelId).waitForThread({ timeout: 8_000, predicate: (thread) => !before.has(thread.id) })
  await waitForFooter({ discord: twin.discord, threadId: thread.id })
  expect(await twin.discord.thread(thread.id).text()).toContain('cloud voice ok')
  expect(openai.requests).toHaveLength(1)
})
