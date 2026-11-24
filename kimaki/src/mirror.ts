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

import path from 'node:path'

import { oc, readMarker, textChannel, type Bot, type SessionMarker } from './bot.ts'
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
