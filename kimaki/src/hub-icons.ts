// Fork: a Kimaki connected to a Vocorum hub (KIMAKI_GATEWAY_PROXY_URL pointing at the hub,
// KIMAKI_BOT_TOKEN its clientId:secret) shows this machine's Discord look there: the
// avatar of this machine's own Discord bot and the icon of its main Discord server.
//
//   ~/.kimaki (this machine's Discord bot) ─ token, project channels' guilds
//     Discord: /users/@me, /guilds/<main> ─▶ CDN png bytes
//     hub: GET /hub/machine-icons {avatar, guild_icon} hashes ─ differs? ─▶ PUT /hub/machine-icons/<kind>
//
// The Discord token stays in this process: only image bytes go to the hub. The main
// server is the guild most project channels belong to. Hashes are sha256 hex, first 32.

import crypto from 'node:crypto'
import path from 'node:path'
import { createClient } from '@libsql/client'

import { createLogger } from './logger.ts'

const logger = createLogger('HUBICONS')

export const HUB_ICON_KINDS = ['avatar', 'guild_icon'] as const
type Kind = (typeof HUB_ICON_KINDS)[number]

export type HubIconUrls = { discordApi: string; cdn: string }
const DISCORD_URLS: HubIconUrls = { discordApi: 'https://discord.com/api/v10', cdn: 'https://cdn.discordapp.com' }

export function iconHash(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32)
}

// The hub's own base URL, from the REST URL Kimaki uses there (`<base>/api`).
// null for Discord and the shared kimaki.dev gateway: only a hub takes pictures.
export function hubBaseUrl({ restUrl, token }: { restUrl: string | null | undefined; token: string }): string | null {
  if (!restUrl || !token.includes(':')) return null
  const url = new URL(restUrl)
  if (url.hostname === 'discord.com' || url.hostname.endsWith('.kimaki.dev')) return null
  return new URL(url.pathname.replace(/\/api\/?$/, '/') || '/', url).toString().replace(/\/$/, '')
}

// This machine's Discord bot: the self-hosted token and the most common guild of the
// project channels, from the first data dir that has one.
async function discordSource(dataDirs: readonly string[]): Promise<{ token: string; guildId: string | null } | null> {
  for (const dir of [...new Set(dataDirs.map((d) => path.resolve(d)))]) {
    const client = createClient({ url: `file:${path.join(dir, 'kimaki.db')}` })
    const found = await (async () => {
      const token = (await client.execute("SELECT token FROM bot_tokens WHERE bot_mode = 'self_hosted' ORDER BY last_used_at DESC LIMIT 1")).rows[0]?.['token']
      if (typeof token !== 'string' || !token) return null
      const guild = (await client.execute('SELECT guild_id FROM channel_directories WHERE guild_id IS NOT NULL GROUP BY guild_id ORDER BY count(*) DESC LIMIT 1')).rows[0]?.['guild_id']
      return { token, guildId: typeof guild === 'string' ? guild : null }
    })().catch(() => null)
    client.close()
    if (found) return found
  }
  return null
}

async function getJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown> | null> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!response?.ok) return null
  const body = (await response.json().catch(() => null)) as unknown
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

async function getBytes(url: string): Promise<Uint8Array | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!response?.ok) return null
  return new Uint8Array(await response.arrayBuffer())
}

// Uploads what changed; returns the kinds it uploaded. Never throws.
export async function syncHubIcons({ hubUrl, hubToken, dataDirs, urls = DISCORD_URLS }: {
  hubUrl: string
  hubToken: string
  // Where this machine's Discord bot lives: the hub instance's own data dir, then ~/.kimaki.
  dataDirs: readonly string[]
  urls?: HubIconUrls
}): Promise<Kind[]> {
  const source = await discordSource(dataDirs)
  if (!source) return []
  const discord = { authorization: `Bot ${source.token}`, 'user-agent': 'DiscordBot (https://github.com/remorses/kimaki, 1)' }
  const me = await getJson(`${urls.discordApi}/users/@me`, discord)
  const guild = source.guildId ? await getJson(`${urls.discordApi}/guilds/${source.guildId}`, discord) : null
  const images: Record<Kind, string | null> = {
    avatar: me && typeof me['avatar'] === 'string' ? `${urls.cdn}/avatars/${String(me['id'])}/${me['avatar']}.png?size=256` : null,
    guild_icon: guild && typeof guild['icon'] === 'string' ? `${urls.cdn}/icons/${String(guild['id'])}/${guild['icon']}.png?size=256` : null,
  }
  const hub = { authorization: `Bot ${hubToken}` }
  const current = (await getJson(`${hubUrl}/hub/machine-icons`, hub)) ?? {}
  const uploaded: Kind[] = []
  for (const kind of HUB_ICON_KINDS) {
    const url = images[kind]
    if (!url) continue
    const bytes = await getBytes(url)
    if (!bytes || current[kind] === iconHash(bytes)) continue
    const response = await fetch(`${hubUrl}/hub/machine-icons/${kind}`, { method: 'PUT', headers: { ...hub, 'content-type': 'image/png' }, body: bytes, signal: AbortSignal.timeout(30_000) }).catch((error: Error) => error)
    if (response instanceof Error || !response.ok) {
      logger.warn(`hub ${kind} upload failed: ${response instanceof Error ? response.message : response.status}`)
      continue
    }
    uploaded.push(kind)
  }
  if (uploaded.length) logger.log(`uploaded ${uploaded.join(' and ')} to the hub`)
  return uploaded
}
