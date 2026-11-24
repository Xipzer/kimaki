import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from 'vitest'

import { openDb } from './db.ts'
import { hubBaseUrl, iconHash, syncHubIcons } from './hub-icons.ts'
import * as schema from './schema.ts'
import { tempDataDir } from './test/harness.ts'

test('hubBaseUrl: only a hub reached with a clientId:secret token takes pictures', () => {
  expect([
    hubBaseUrl({ restUrl: 'http://127.0.0.1:8090/api', token: 'id:secret' }),
    hubBaseUrl({ restUrl: 'https://hub.example.ts.net/vocorum/api', token: 'id:secret' }),
    hubBaseUrl({ restUrl: 'https://discord-gateway.kimaki.dev/api', token: 'id:secret' }),
    hubBaseUrl({ restUrl: 'http://127.0.0.1:8090/api', token: 'MTQ2.discord.token' }),
    hubBaseUrl({ restUrl: null, token: 'id:secret' }),
  ]).toEqual(['http://127.0.0.1:8090', 'https://hub.example.ts.net/vocorum', null, null, null])
})

test('syncHubIcons uploads the bot avatar and main server icon once, and never sends the Discord token to the hub', async () => {
  // The hub instance's own data dir has no Discord bot; the machine's main one does.
  const hubDir = tempDataDir()
  const mainDir = tempDataDir()
  for (const dir of [hubDir, mainDir]) {
    const opened = await openDb({ dataDir: dir, migrate: true })
    if (opened instanceof Error) throw opened
    if (dir === mainDir) {
      await opened.db.insert(schema.bot_tokens).values({ app_id: '111', token: 'DISCORD-SECRET', bot_mode: 'self_hosted' })
      await opened.db.insert(schema.channel_directories).values([
        { channel_id: 'c1', directory: '/a', channel_type: 'text', guild_id: 'g-main' },
        { channel_id: 'c2', directory: '/b', channel_type: 'text', guild_id: 'g-main' },
        { channel_id: 'c3', directory: '/c', channel_type: 'text', guild_id: 'g-other' },
      ])
    }
    opened.close()
  }
  const avatar = Buffer.from('avatar-png-bytes')
  const icon = Buffer.from('icon-png-bytes')
  const hubState: Record<string, string | null> = { avatar: null, guild_icon: null }
  const requests: Array<{ method: string; url: string; authorization: string }> = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', authorization: req.headers.authorization ?? '' })
      const json = (value: unknown) => res.setHeader('content-type', 'application/json').end(JSON.stringify(value))
      if (req.url === '/discord/users/@me') return json({ id: '111', avatar: 'a1' })
      if (req.url === '/discord/guilds/g-main') return json({ id: 'g-main', icon: 'i1' })
      if (req.url === '/cdn/avatars/111/a1.png?size=256') return res.end(avatar)
      if (req.url === '/cdn/icons/g-main/i1.png?size=256') return res.end(icon)
      if (req.url === '/hub/machine-icons' && req.method === 'GET') return json({ machine: 'Printer', ...hubState })
      const kind = req.url?.match(/^\/hub\/machine-icons\/(avatar|guild_icon)$/)?.[1]
      if (kind && req.method === 'PUT') {
        hubState[kind] = iconHash(Buffer.concat(chunks))
        return json({ machine: 'Printer', ...hubState })
      }
      res.statusCode = 404
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const sync = () => syncHubIcons({ hubUrl: `${base}`, hubToken: 'hub-id:hub-secret', dataDirs: [hubDir, mainDir], urls: { discordApi: `${base}/discord`, cdn: `${base}/cdn` } })
  try {
    expect(await sync()).toEqual(['avatar', 'guild_icon'])
    expect(hubState).toEqual({ avatar: iconHash(avatar), guild_icon: iconHash(icon) })
    // Unchanged pictures are not uploaded again.
    expect(await sync()).toEqual([])
    const hubCalls = requests.filter((r) => r.url.startsWith('/hub/'))
    expect(hubCalls.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET /hub/machine-icons',
      'PUT /hub/machine-icons/avatar',
      'PUT /hub/machine-icons/guild_icon',
      'GET /hub/machine-icons',
    ])
    expect(hubCalls.every((r) => r.authorization === 'Bot hub-id:hub-secret')).toBe(true)
    expect(requests.filter((r) => r.url.startsWith('/discord/')).every((r) => r.authorization === 'Bot DISCORD-SECRET')).toBe(true)
  } finally {
    server.close()
  }
})
