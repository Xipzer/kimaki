// Fork: `kimaki session search` (removed upstream in 1.1) still finds sessions
// by title and by message content, per channel and across all projects.

import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { BotHandle } from './main.ts'
import { send } from './prompt.ts'
import { seedProjectChannel, startOpencodeTestServer, startTestBot, startTwin, tempDataDir, textParts, waitForFooter, warmUp, type OpencodeTestServer, type TestTwin } from './test/harness.ts'

const exec = promisify(execFile)
const dataDir = tempDataDir()
let server: OpencodeTestServer
let twin: TestTwin
let bot: BotHandle

beforeAll(async () => {
  ;[server, twin] = await Promise.all([
    startOpencodeTestServer({ matchers: [{ id: 'search', priority: 500, when: { latestUserTextIncludes: 'search-marker' }, then: { parts: textParts('reply mentions zebra-fresnel') } }] }),
    startTwin(),
  ])
  await seedProjectChannel({ dataDir, channelId: twin.channelId, guildId: twin.discord.guildId, directory: server.projectDirectory })
  bot = await startTestBot({ dataDir, twin, server })
  await warmUp({ server })
}, 60_000)

afterAll(async () => {
  await bot?.stop()
  await Promise.all([server?.stop(), twin?.stop()])
  fs.rmSync(dataDir, { recursive: true, force: true })
})

function cli(args: string[]) {
  return exec(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'), path.resolve('src/cli.ts'), ...args, '--data-dir', dataDir], {
    cwd: server.projectDirectory,
    env: { ...process.env, KIMAKI_LOCK_PORT: String(bot.lock.port), KIMAKI_OPENCODE_SERVICE_FILE: server.serviceFile, KIMAKI_DISCORD_REST_URL: twin.discord.restUrl },
  })
}

test('session search matches message content by channel, across projects, as JSON and by regex', async () => {
  const started = await send(bot, { channelId: twin.channelId, prompt: 'search-marker please' })
  if (started instanceof Error || !started.sessionId) throw new Error('Expected a session')
  await waitForFooter({ discord: twin.discord, threadId: started.threadId })

  const byChannel = await cli(['session', 'search', 'search-marker', '--channel', twin.channelId])
  expect(byChannel.stdout).toContain(started.sessionId)

  const all = await cli(['session', 'search', 'zebra-fresnel', '--all', '--days', '14', '--json'])
  expect((JSON.parse(all.stdout) as Array<{ id: string }>).map((row) => row.id)).toEqual([started.sessionId])

  const regex = await cli(['session', 'search', '/ZEBRA-fres+nel/i', '--all', '--json'])
  expect((JSON.parse(regex.stdout) as Array<{ id: string }>).map((row) => row.id)).toEqual([started.sessionId])

  const none = await cli(['session', 'search', 'no-such-text-anywhere', '--all', '--json'])
  expect(JSON.parse(none.stdout)).toEqual([])
})
