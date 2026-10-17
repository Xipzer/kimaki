// Fork: commands another app registered on the same Discord application
// (for example /assistant, /whisper-*) survive Kimaki's guild command registration.

import fs from 'node:fs'
import path from 'node:path'
import { Routes, type APIApplicationCommand } from 'discord.js'
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { BotHandle } from './main.ts'
import { seedProjectChannel, startOpencodeTestServer, startTestBot, startTwin, tempDataDir, type OpencodeTestServer, type TestTwin } from './test/harness.ts'

let server: OpencodeTestServer
let twin: TestTwin
let bot: BotHandle
let dataDir: string

beforeAll(async () => {
  dataDir = tempDataDir()
  ;[server, twin] = await Promise.all([startOpencodeTestServer({ matchers: [] }), startTwin()])
  await seedProjectChannel({ dataDir, channelId: twin.channelId, guildId: twin.discord.guildId, directory: server.projectDirectory })
  bot = await startTestBot({ dataDir, twin, server })
})

afterAll(async () => {
  await bot?.stop()
  await twin?.stop()
  await server?.stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

async function names() {
  return (await twin.discord.getRegisteredCommands()).map((command) => command.name)
}

async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline && !(await check())) await new Promise((resolve) => setTimeout(resolve, 100))
}

test('a catalog refresh keeps other apps commands and still drops stale Kimaki ones', async () => {
  await until(async () => (await names()).includes('abort'))
  const route = Routes.applicationGuildCommands(bot.discord.user!.id, twin.discord.guildId)
  const current = (await bot.discord.rest.get(route)) as APIApplicationCommand[]
  const extra = [
    { name: 'assistant', description: 'Assistant panel' },
    { name: 'whisper-start', description: 'Start local transcription' },
    { name: 'stale-agent', description: 'An agent that no longer exists' },
  ]
  await bot.discord.rest.put(route, { body: [...current.map(({ name, description, options }) => ({ name, description, options })), ...extra] })

  const skillFile = path.join(server.skillsDirectory, 'foreign', 'SKILL.md')
  fs.mkdirSync(path.dirname(skillFile), { recursive: true })
  fs.writeFileSync(skillFile, '---\nname: foreign\ndescription: Foreign test skill\n---\nTest.\n')
  await until(async () => (await names()).includes('foreign-skill'))

  const after = await names()
  expect(after).toContain('foreign-skill')
  expect(after).toContain('abort')
  expect(after.filter((name) => ['assistant', 'whisper-start', 'stale-agent'].includes(name)).sort()).toEqual(['assistant', 'whisper-start'])
})
