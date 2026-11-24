// Fork: linked sessions. Sessions that talk to each other keep a two-way link,
// shown to both as a system instruction entry, so a liaison is not forgotten
// when the session history is compacted.
//
//   kimaki send --thread/--session X  (from session A)  ─┐
//   kimaki send --parent-session A    (new session X)   ─┼─▶ session_links A⇄X ─▶ entry "kimaki-links" of A and X
//   a prompt to A that names ses_… or a Kimaki thread   ─┘
//   kimaki session links --add/--remove                  ─▶ same table, same entries
//
// Across machines (each with its own bot) the sender names itself in the send:
//   machine 1: kimaki send --host <ssh alias> --thread X   ─ssh─▶ machine 2: kimaki send --thread X --from-session A --from-thread T --from-machine M
//   machine 2 links X ⇄ A (thread T, machine M) and shows "from M · thread T · session A" under the prompt;
//   machine 1 links A ⇄ X from the answer {threadId, sessionId}. Same-bot remote envelopes carry the same fields.
//
// The entry lists the 8 most recent links. Sessions of another machine are
// linked too (their ID is enough to `kimaki send --session`), but only local
// sessions get the entry. A running session's entry is written once its run
// ends: changing a session's instructions mid-run changes that run.

import * as orm from 'drizzle-orm'

import { oc, type Bot } from './bot.ts'
import { DbError } from './errors.ts'
import { createLogger } from './logger.ts'
import * as schema from './schema.ts'
import { isBusy } from './thread-reducer.ts'

const logger = createLogger('LINKS')

export const LINKS_INSTRUCTION_KEY = 'kimaki-links'
export const MAX_SHOWN_LINKS = 8
// A pasted log can name many sessions: only the first few of one prompt become links.
const MAX_MENTIONS = 5

const SESSION_ID = /\bses_[0-9A-Za-z]{26}\b/g
const THREAD_REF = /discord\.com\/channels\/\d+\/(\d{17,20})|<#(\d{17,20})>/g

export type LinkSource = 'send' | 'parent' | 'mention' | 'manual' | 'remote'

// The other side when it lives on another machine.
export type RemoteSide = { sessionId?: string | null; threadId?: string | null; machine?: string | null; title?: string | null }

export type SessionLink = {
  // `thread:<id>` while the session of another machine's thread is unknown.
  sessionId: string
  threadId: string | null
  machine: string | null
  title: string | null
  source: string
  lastContactAt: Date
}

// Session IDs and thread IDs a prompt names, in order, without duplicates.
export function mentionedIds(text: string): { sessionIds: string[]; threadIds: string[] } {
  const sessionIds = [...new Set([...text.matchAll(SESSION_ID)].map((match) => match[0]))]
  const threadIds = [...new Set([...text.matchAll(THREAD_REF)].map((match) => match[1] ?? match[2]!))]
  return { sessionIds, threadIds }
}

export function linksBlock(links: readonly SessionLink[]): string {
  if (links.length === 0) return ''
  const lines = links.slice(0, MAX_SHOWN_LINKS).map((link) => {
    const session = link.sessionId.startsWith('thread:') ? null : `session ${link.sessionId}`
    const parts = [link.title ?? 'untitled', link.threadId ? `thread ${link.threadId}` : null, session, link.machine ? `on ${link.machine}` : null, `last contact ${link.lastContactAt.toISOString().slice(0, 10)}`]
    return `- ${parts.filter(Boolean).join(' · ')}`
  })
  return [
    '## Linked sessions',
    '',
    'Your liaisons: sessions you worked with. Ask them instead of redoing their work. They survive compaction of this session.',
    ...lines,
    '',
    "Message one with `kimaki send --thread <thread> --prompt '... queue' --agent <current_agent>` (or `--session <session>`); the `queue` suffix waits for its current run. One on another machine: add `--host <ssh alias of that machine>`.",
    'Fix the list with `kimaki session links --add <id>` or `--remove <id>`.',
  ].join('\n')
}

// Session of a thread, from this machine's bindings.
async function sessionOfThread(bot: Bot, threadId: string): Promise<string | null> {
  const local = bot.store.getState().roots[threadId]
  if (local) return local
  const row = await bot.db.query.thread_sessions.findFirst({ where: { thread_id: threadId } }).catch(() => null)
  return row?.session_id ?? null
}

// A session ID, thread ID or thread URL, as a session ID.
export async function resolveLinkTarget(bot: Bot, id: string): Promise<string | null> {
  const value = id.trim()
  if (/^ses_[0-9A-Za-z]{26}$/.test(value)) return value
  const thread = /(\d{17,20})\/?$/.exec(value)?.[1]
  return thread ? sessionOfThread(bot, thread) : null
}

export async function listLinks(bot: Bot, sessionId: string): Promise<DbError | SessionLink[]> {
  const rows = await bot.db
    .select()
    .from(schema.session_links)
    .where(orm.eq(schema.session_links.session_id, sessionId))
    .orderBy(orm.desc(schema.session_links.last_contact_at))
    .catch((cause) => new DbError({ operation: 'read session_links', cause }))
  if (rows instanceof Error) return rows
  const threads = await bot.db.query.thread_sessions
    .findMany({ where: { session_id: { in: rows.map((row) => row.linked_session_id) } } })
    .catch(() => [])
  return rows.map((row) => {
    const thread = threads.find((entry) => entry.session_id === row.linked_session_id)
    return {
      sessionId: row.linked_session_id,
      threadId: row.linked_thread_id ?? thread?.thread_id ?? bot.store.getState().sessionThreads[row.linked_session_id] ?? null,
      machine: row.linked_machine ?? null,
      title: row.linked_title ?? thread?.last_synced_name ?? null,
      source: row.source,
      lastContactAt: row.last_contact_at ?? new Date(0),
    }
  })
}

// Sessions whose entry waits for the end of their run, per bot.
const stale = new WeakMap<Bot, Set<string>>()
// Last entry written per session: every write adds a system message to the session, so an unchanged list is not written.
const written = new WeakMap<Bot, Map<string, string>>()

function running(bot: Bot, sessionId: string): boolean {
  const { sessionThreads, threads } = bot.store.getState()
  const view = threads[sessionThreads[sessionId] ?? '']
  return !!view && isBusy(view)
}

function refreshWhenIdle(bot: Bot, sessionId: string) {
  const pending = stale.get(bot)
  if (pending) return void pending.add(sessionId)
  const waiting = new Set([sessionId])
  stale.set(bot, waiting)
  bot.store.subscribe(() => {
    for (const id of [...waiting]) {
      if (running(bot, id)) continue
      waiting.delete(id)
      void refreshLinksEntry(bot, id)
    }
  })
}

// Writes the entry of a local session; another machine's session is skipped.
export async function refreshLinksEntry(bot: Bot, sessionId: string): Promise<void> {
  if (!bot.store.getState().sessionThreads[sessionId]) return
  if (running(bot, sessionId)) return refreshWhenIdle(bot, sessionId)
  const links = await listLinks(bot, sessionId)
  if (links instanceof Error) return logger.warn(links)
  // Titles of local sessions come from OpenCode when the thread name was never synced.
  for (const link of links.slice(0, MAX_SHOWN_LINKS)) {
    if (link.title || !bot.store.getState().sessionThreads[link.sessionId]) continue
    const session = await oc(bot, 'session.get', (client) => client.session.get({ sessionID: link.sessionId }))
    if (!(session instanceof Error)) link.title = session.title ?? null
  }
  const value = linksBlock(links)
  const cache = written.get(bot) ?? new Map<string, string>()
  written.set(bot, cache)
  if (cache.get(sessionId) === value) return
  const put = await oc(bot, 'instructions.entry.put', (client) =>
    client.session.instructions.entry.put({ sessionID: sessionId, key: LINKS_INSTRUCTION_KEY, value }),
  )
  if (put instanceof Error) return logger.warn(`links entry of ${sessionId}`, put)
  cache.set(sessionId, value)
}

// `remote`: b lives on another machine; its row in a's list keeps how to reach it.
export async function linkSessions(bot: Bot, { a, b, source, remote }: { a: string; b: string; source: LinkSource; remote?: RemoteSide }): Promise<DbError | void> {
  if (!a || !b || a === b) return
  const now = new Date()
  const meta = remote
    ? Object.fromEntries(Object.entries({ linked_thread_id: remote.threadId, linked_machine: remote.machine, linked_title: remote.title }).filter(([, value]) => value))
    : {}
  for (const [from, to, extra] of [[a, b, meta], [b, a, {}]] as const) {
    const saved = await bot.db
      .insert(schema.session_links)
      .values({ session_id: from, linked_session_id: to, source, last_contact_at: now, ...extra })
      .onConflictDoUpdate({ target: [schema.session_links.session_id, schema.session_links.linked_session_id], set: { last_contact_at: now, ...extra } })
      .catch((cause) => new DbError({ operation: 'write session_links', cause }))
    if (saved instanceof Error) return saved
  }
  // The session of a thread that was linked before it was known replaces the placeholder.
  if (remote?.threadId && !b.startsWith('thread:')) await unlinkSessions(bot, { a, b: `thread:${remote.threadId}`, refresh: false })
  await Promise.all([refreshLinksEntry(bot, a), refreshLinksEntry(bot, b)])
}

// Links a local session with one on another machine, from what the send carried.
export async function linkRemote(bot: Bot, { sessionId, remote }: { sessionId: string; remote: RemoteSide }): Promise<void> {
  const other = remote.sessionId ?? (remote.threadId ? `thread:${remote.threadId}` : null)
  if (!other) return
  const linked = await linkSessions(bot, { a: sessionId, b: other, source: 'remote', remote })
  if (linked instanceof Error) logger.warn(linked)
}

// The line under a prompt from another machine. Stable: other tools parse it.
export function sourceLine(remote: RemoteSide): string {
  const parts = [`from ${remote.machine ?? 'another machine'}`, remote.threadId ? `thread ${remote.threadId}` : null, remote.sessionId ? `session ${remote.sessionId}` : null]
  return `-# ${parts.filter(Boolean).join(' · ')}`
}

export async function unlinkSessions(bot: Bot, { a, b, refresh = true }: { a: string; b: string; refresh?: boolean }): Promise<DbError | void> {
  const removed = await bot.db
    .delete(schema.session_links)
    .where(orm.or(
      orm.and(orm.eq(schema.session_links.session_id, a), orm.eq(schema.session_links.linked_session_id, b)),
      orm.and(orm.eq(schema.session_links.session_id, b), orm.eq(schema.session_links.linked_session_id, a)),
    ))
    .catch((cause) => new DbError({ operation: 'delete session_links', cause }))
  if (removed instanceof Error) return removed
  if (refresh) await Promise.all([refreshLinksEntry(bot, a), refreshLinksEntry(bot, b)])
}

// Hook for every prompt that reaches a session: the sending session, the
// parent of a new session, and sessions or threads the text names.
// Never fails the prompt: errors are logged.
export async function recordPromptLinks(
  bot: Bot,
  { sessionId, text, senderSessionId, parentSessionId }: { sessionId: string; text: string; senderSessionId?: string; parentSessionId?: string | null },
): Promise<void> {
  const targets: Array<{ id: string; source: LinkSource }> = []
  if (parentSessionId) targets.push({ id: parentSessionId, source: 'parent' })
  if (senderSessionId) targets.push({ id: senderSessionId, source: 'send' })
  const { sessionIds, threadIds } = mentionedIds(text)
  const ownThread = bot.store.getState().sessionThreads[sessionId]
  const mentioned = [...sessionIds]
  for (const threadId of threadIds) {
    if (threadId === ownThread) continue
    const found = await sessionOfThread(bot, threadId)
    if (found) mentioned.push(found)
  }
  for (const id of [...new Set(mentioned)].slice(0, MAX_MENTIONS)) targets.push({ id, source: 'mention' })
  const seen = new Set<string>()
  for (const { id, source } of targets) {
    if (id === sessionId || seen.has(id)) continue
    seen.add(id)
    const linked = await linkSessions(bot, { a: sessionId, b: id, source })
    if (linked instanceof Error) logger.warn(linked)
  }
}
