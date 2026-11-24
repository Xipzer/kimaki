// Fork: one session, two chats. Two Kimaki processes on one machine share its OpenCode
// service: one on Discord, one on a Vocorum hub (`--peer-data-dir` names the other).
// The session is the shared key; each process renders it in its own thread.
//
//   Discord Kimaki ──prompt (metadata.discord.home "Discord")──▶ OpenCode session ◀── Vocorum Kimaki
//         ▲                                                          │
//         └──────────── both render every event in their thread ◀────┘
//
// - A session one side starts is unknown to the other; on its first event the other side
//   adopts it here: the thread with the same ID when the hub imported it, else a new thread
//   in the channel with the same ID or in its project channel for the directory.
// - The side that started a session keeps its marker and instructions (isPeerMarker).
// - A prompt typed on the other side shows as `» **user (Vocorum):** text` (queue.ts inputFields).
//
// On a Vocorum hub (hubUrl set) the hub side also uses the hub's mirror API, so ids match Discord:
//   start:    PUT /hub/mirror/guilds/:id and /channels/:id for the peer's project channels, then
//             copies their channel_directories rows (syncPeerChannels)
//   adoption: PUT /hub/mirror/channels/:threadId creates the Discord thread's twin with its id
//   prompts:  PUT /hub/mirror/messages/:id shows a Discord-typed prompt as the person's own
//             message (never delivered to hub bots) instead of the echo line (mirrorPrompt)

import path from 'node:path'

import { createClient } from '@libsql/client'

import { oc, readMarker, textChannel, type Bot, type SessionMarker } from './bot.ts'
import { discordSource, getJson } from './hub-icons.ts'
import type { MirroredPrompt } from './queue.ts'
import { createLogger } from './logger.ts'
import * as schema from './schema.ts'
import { channelForDirectory } from './sessions.ts'
import type { ThreadEvent } from './thread-reducer.ts'

const logger = createLogger('MIRROR')

export function isPeerMarker(bot: Pick<Bot, 'peerDataDirs'>, marker: SessionMarker | null): boolean {
  return Boolean(marker?.dataDir && bot.peerDataDirs.includes(path.resolve(marker.dataDir)))
}

// Binds a root session a peer started to a thread here; returns the thread, or null when
// the session is not a peer's. `held`: its events so far; a new session starts from them.
export async function adoptPeerSession(bot: Bot, { sessionId, held }: { sessionId: string; held: readonly ThreadEvent[] }): Promise<string | null> {
  const info = await oc(bot, 'session.get', (client) => client.session.get({ sessionID: sessionId }))
  if (info instanceof Error) {
    logger.warn(`cannot read session ${sessionId}`, info)
    return null
  }
  const marker = readMarker(info.metadata)
  if (info.parentID || !isPeerMarker(bot, marker)) return null
  const peerThread = typeof marker?.fields['threadId'] === 'string' ? marker.fields['threadId'] : null
  const peerChannel = typeof marker?.fields['channelId'] === 'string' ? marker.fields['channelId'] : null
  // Coordinator channels are one long session per channel: not mirrored.
  if (!peerThread || peerThread === peerChannel) return null
  const isNew = held[0]?.type === 'session.created'
  const directory = info.location.directory
  const title = (info.title ?? 'Untitled').replace(/\s+/g, ' ').slice(0, 100)

  // Same IDs when the hub imported the channel: it is one of this side's project channels too.
  const known = peerChannel
    ? await bot.db.query.channel_directories.findFirst({ where: { channel_id: peerChannel } }).catch(() => undefined)
    : undefined
  // On a hub, the Discord thread's twin gets the same id.
  if (known && bot.hubUrl) {
    await hubPut(bot, `/hub/mirror/channels/${peerThread}`, { id: peerThread, guild_id: known.guild_id, type: 11, name: title, parent_id: known.channel_id })
  }
  const same = known ? await bot.discord.channels.fetch(peerThread).catch(() => null) : null
  const bound = same?.isThread() && same.parentId === known?.channel_id ? { thread: same, channelId: same.parentId, created: false } : await (async () => {
    const channelId = known ? known.channel_id : await channelForDirectory(bot, directory)
    if (channelId instanceof Error) return channelId
    const channel = await textChannel(bot, channelId)
    if (channel instanceof Error) return channel
    const thread = await channel.threads.create({ name: title, autoArchiveDuration: 1440 }).catch((cause: Error) => cause)
    if (thread instanceof Error) return thread
    return { thread, channelId, created: true }
  })()
  if (bound instanceof Error) {
    logger.warn(`no thread for session ${sessionId}`, bound)
    return null
  }
  const threadId = bound.thread.id
  const saved = await bot.db
    .insert(schema.thread_sessions)
    .values({ thread_id: threadId, session_id: sessionId, source: 'kimaki' })
    .onConflictDoUpdate({ target: schema.thread_sessions.thread_id, set: { session_id: sessionId } })
    .catch((cause: Error) => cause)
  if (saved instanceof Error) {
    logger.warn(`cannot save the thread of session ${sessionId}`, saved)
    return null
  }
  // An older session in a new thread shows its history; an imported thread already has it.
  const history = !isNew && bound.created
    ? await oc(bot, 'message.list', (client) => client.message.list({ sessionID: sessionId, order: 'desc', limit: 100 }))
    : null
  const first: ThreadEvent[] = isNew
    ? [...held]
    : history && !(history instanceof Error)
      ? [{ type: 'kimaki.replay', messages: [...history.data].reverse(), note: '-# Mirrored session: messages here and in the other chat reach the same agent.' }]
      : []
  await bot.eventLoop.bind({ threadId, sessionId, channelId: bound.channelId, directory, isNew, first })
  if (!isNew) {
    const hydrated = await bot.eventLoop.syncThread(threadId)
    if (hydrated instanceof Error) logger.warn(`hydrate ${threadId}`, hydrated)
  }
  logger.log(`mirrored session ${sessionId} in thread ${threadId}${bound.created ? '' : ' (same ID)'}`)
  return threadId
}

async function hubPut(bot: Pick<Bot, 'hubUrl' | 'token'>, pathname: string, body: unknown): Promise<boolean> {
  if (!bot.hubUrl) return false
  const response = await fetch(`${bot.hubUrl}${pathname}`, {
    method: 'PUT',
    headers: { authorization: `Bot ${bot.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  }).catch((error: Error) => error)
  if (response instanceof Error || !response.ok) {
    logger.warn(`hub PUT ${pathname} failed: ${response instanceof Error ? response.message : `${response.status} ${(await response.text().catch(() => '')).slice(0, 200)}`}`)
    return false
  }
  return true
}

const DISCORD_EPOCH = 1_420_070_400_000

// A Discord-typed prompt in the hub thread, as the person's own message with its Discord id.
export function mirrorPrompt(bot: Pick<Bot, 'hubUrl' | 'token'>) {
  return (threadId: string, prompt: MirroredPrompt) =>
    hubPut(bot, `/hub/mirror/messages/${prompt.messageId}`, {
      id: prompt.messageId,
      channel_id: threadId,
      author: { id: prompt.userId, username: prompt.username },
      content: prompt.text,
      timestamp: new Date(Number(BigInt(prompt.messageId) >> 22n) + DISCORD_EPOCH).toISOString(),
      type: 0,
    })
}

// Hub side at start: the peer's project channels exist here with the same ids and directories.
// Guild names and missing channels come from Discord with this machine's own Discord bot.
export async function syncPeerChannels(bot: Bot): Promise<void> {
  if (!bot.hubUrl) return
  type Row = { channel_id: string; directory: string; channel_type: string; guild_id: string | null }
  const rows: Row[] = []
  for (const dir of bot.peerDataDirs) {
    const client = createClient({ url: `file:${path.join(dir, 'kimaki.db')}` })
    const read = await client.execute("SELECT channel_id, directory, channel_type, guild_id FROM channel_directories WHERE channel_type = 'text'").catch((error: Error) => error)
    client.close()
    if (read instanceof Error) {
      logger.warn(`cannot read the project channels of ${dir}`, read)
      continue
    }
    for (const row of read.rows) rows.push({ channel_id: String(row['channel_id']), directory: String(row['directory']), channel_type: String(row['channel_type']), guild_id: row['guild_id'] ? String(row['guild_id']) : null })
  }
  const mine = new Set((await bot.db.query.channel_directories.findMany().catch(() => [])).map((row) => row.channel_id))
  const missing = rows.filter((row) => !mine.has(row.channel_id))
  if (missing.length === 0) return
  const source = await discordSource(bot.peerDataDirs)
  const discordApi = 'https://discord.com/api/v10'
  const headers = source ? { authorization: `Bot ${source.token}`, 'user-agent': 'DiscordBot (https://github.com/remorses/kimaki, 1)' } : null
  const joined = new Set<string>()
  let added = 0
  for (const row of missing) {
    // Older rows have no guild: Discord knows it (a deleted channel answers 404 and is skipped).
    const discordChannel = !row.guild_id && headers ? await getJson(`${discordApi}/channels/${row.channel_id}`, headers) : null
    const guildId = row.guild_id ?? (typeof discordChannel?.['guild_id'] === 'string' ? discordChannel['guild_id'] : null)
    if (!guildId) continue
    if (!joined.has(guildId)) {
      const guild = headers ? await getJson(`${discordApi}/guilds/${guildId}`, headers) : null
      if (!(await hubPut(bot, `/hub/mirror/guilds/${guildId}`, { name: typeof guild?.['name'] === 'string' ? guild['name'] : '' }))) continue
      joined.add(guildId)
    }
    // Imported channels exist already; others are created from Discord, category first.
    const exists = await bot.discord.channels.fetch(row.channel_id).catch(() => null)
    if (!exists && headers) {
      const channel = discordChannel ?? await getJson(`${discordApi}/channels/${row.channel_id}`, headers)
      if (!channel) continue
      const parent = typeof channel['parent_id'] === 'string' ? await getJson(`${discordApi}/channels/${channel['parent_id']}`, headers) : null
      if (parent && !(await hubPut(bot, `/hub/mirror/channels/${String(parent['id'])}`, parent))) continue
      if (!(await hubPut(bot, `/hub/mirror/channels/${row.channel_id}`, channel))) continue
    }
    const saved = await bot.db
      .insert(schema.channel_directories)
      .values({ channel_id: row.channel_id, directory: row.directory, channel_type: 'text', guild_id: guildId })
      .onConflictDoNothing()
      .catch((error: Error) => error)
    if (saved instanceof Error) logger.warn(`cannot save project channel ${row.channel_id}`, saved)
    else added++
  }
  logger.log(`project channels from the other chat: ${added} added, in ${joined.size} hub guild(s)`)
}
