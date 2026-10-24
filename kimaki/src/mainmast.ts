// Mainmast notes: when a thread session finishes a run, its mainmast learns
// about it, so the coordinator always knows what happened in its project.
//
//   thread run ends ─▶ `kimaki send --wait` prompt, target still busy?   ─▶ no note: the wait prints the answer
//                  ├─▶ session started by a mainmast (--parent-session)? ─▶ note + wake that mainmast
//                  └─▶ else, the thread's channel has a mainmast?        ─▶ silent note (read at next prompt)
//
// The note is a synthetic inbox item, like OpenCode's own subagent completion
// (core/src/session/subagent-completion.ts): `resume` decides if it wakes the session.

import { oc, projectOf, readMarker, threadOfSession, type Bot, type MainmastTimers } from './bot.ts'
import { parseDuration } from './duration.ts'
import type { RunEnded } from './event-loop.ts'
import { createLogger } from './logger.ts'
import { finalAnswer } from './session-events.ts'
import { escapeAttribute } from './system-prompt.ts'

const logger = createLogger('MAINMAST')

// A woken coordinator reads the whole answer; a silent note only says what happened.
const WAKE_ANSWER_CHARS = 2_000
const NOTE_ANSWER_CHARS = 400
const ANSWER_MESSAGES = 30

// OpenCode's warming default (core/src/plugin/warming.ts) and the nudge when warming is off.
const OPENCODE_WARMING_MS = 30 * 60_000
const UNWARMED_NUDGE_MS = 30 * 60_000

// Timers of a new mainmast (plugin/mainmast.ts) from the OpenCode `warming` config of its
// directory, like OpenCode reads it (Config.latest): nudge at half the window, compact at its end.
// Without warming the cache is cold after minutes, so there is nothing to compact cheaply.
export async function mainmastTimers(bot: Bot, directory: string): Promise<MainmastTimers> {
  if (bot.mainmastTimers) return bot.mainmastTimers
  const entries = await oc(bot, 'config.get', (client) => client.config.get({ location: { directory } }))
  if (entries instanceof Error) logger.warn('read warming config', entries)
  const documents = entries instanceof Error ? [] : entries.flatMap((entry) => (entry.type === 'document' ? [entry.info] : []))
  const warming = documents.findLast((info) => info.warming !== undefined)?.warming
  if (!warming) return { nudgeMs: UNWARMED_NUDGE_MS, compactMs: null }
  const parsed = warming === true || !warming.duration ? OPENCODE_WARMING_MS : parseDuration(warming.duration, 'warming.duration')
  const window = parsed instanceof Error ? OPENCODE_WARMING_MS : parsed
  return { nudgeMs: window / 2, compactMs: window }
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

// A conversation that is a project channel holds a mainmast.
async function isMainmastChannel(bot: Bot, conversationId: string): Promise<boolean> {
  const project = await projectOf(bot, conversationId)
  return !(project instanceof Error) && project !== null
}

// The project channel of a session thread, from its view or from Discord.
async function channelOfThread(bot: Bot, threadId: string): Promise<string | null> {
  const view = bot.store.getState().threads[threadId]
  if (view) return view.channelId
  const channel = await bot.discord.channels.fetch(threadId).catch(() => null)
  return channel?.isThread() ? channel.parentId : null
}

// The run's prompt came from `kimaki send --wait` and the target still runs:
// it is waiting in that shell call, which prints the answer. A target that is
// idle lost its wait (shell timeout, interrupt), so it gets the note.
async function waitedFor(bot: Bot, { sessionId, target }: { sessionId: string; target: string }): Promise<boolean> {
  const [prompts, active] = await Promise.all([
    oc(bot, 'message.list', (client) => client.message.list({ sessionID: sessionId, order: 'desc', limit: 1, type: 'user' })),
    oc(bot, 'session.active', (client) => client.session.active()),
  ])
  // On a failed check the note goes out: a duplicate is better than a lost result.
  if (prompts instanceof Error) {
    logger.warn(`wait check of ${sessionId}`, prompts)
    return false
  }
  if (active instanceof Error) {
    logger.warn(`wait check of ${sessionId}`, active)
    return false
  }
  const latest = prompts.data[0]
  return latest?.type === 'user' && latest.metadata?.['waited'] === true && target in active
}

async function noteRunEnded(bot: Bot, run: RunEnded): Promise<void> {
  const channelId = await channelOfThread(bot, run.threadId)
  // The mainmast's own runs, and threads outside any project channel.
  if (!channelId || channelId === run.threadId) return
  const info = await oc(bot, 'session.get', (client) => client.session.get({ sessionID: run.sessionId }))
  if (info instanceof Error) return logger.warn(`note of ${run.sessionId}`, info)
  const marker = readMarker(info.metadata)
  // TODO: also note sessions on other machines (remote `kimaki send`, OpenCode workspaces).
  // Their bot cannot reach this OpenCode server: relay the note through a Discord envelope
  // in the mainmast channel, like remote-send.ts does for prompts.
  const parentConversation = marker?.parentSessionId ? threadOfSession(bot, marker.parentSessionId) : null
  const wake = Boolean(parentConversation && (await isMainmastChannel(bot, parentConversation)))
  const target = wake ? marker?.parentSessionId : bot.store.getState().roots[channelId]
  if (!target || target === run.sessionId) return
  if (await waitedFor(bot, { sessionId: run.sessionId, target })) return
  const messages = await oc(bot, 'message.list', (client) => client.message.list({ sessionID: run.sessionId, order: 'desc', limit: ANSWER_MESSAGES }))
  if (messages instanceof Error) return logger.warn(`answer of ${run.sessionId}`, messages)
  const answer = run.error ?? finalAnswer([...messages.data].reverse()) ?? 'Finished without a text answer.'
  const state = run.error ? 'error' : 'completed'
  const title = info.title || 'Untitled'
  const routine = marker?.task ? ` routine="#${marker.task.id}"` : ''
  const text = [
    `<session-finished sessionID="${run.sessionId}" threadID="${run.threadId}" state="${state}" title="${escapeAttribute(title)}"${routine} wake="${wake}">`,
    cut(answer, wake ? WAKE_ANSWER_CHARS : NOTE_ANSWER_CHARS),
    `More: kimaki session read ${run.sessionId}`,
    ...(wake ? ['The user already sees in Discord that this session finished. Do not repeat it, its answer or its link: reply only with what the user needs to know, else reply with nothing.'] : []),
    '</session-finished>',
  ].join('\n')
  const sent = await oc(bot, 'session.synthetic', (client) =>
    client.session.synthetic({
      sessionID: target,
      text,
      description: `${title} finished`,
      metadata: { source: 'kimaki-session', sessionID: run.sessionId, threadID: run.threadId, title, state, wake },
      resume: wake,
    }),
  )
  if (sent instanceof Error) return logger.warn(`note of ${run.sessionId} to ${target}`, sent)
  logger.log(`${wake ? 'woke' : 'noted'} mainmast ${target}: ${run.sessionId} ${state}`)
}

export function createMainmastNotes() {
  const registered: { bot: Bot | null } = { bot: null }
  return {
    register(bot: Bot) {
      registered.bot = bot
    },
    runEnded(run: RunEnded) {
      const bot = registered.bot
      if (bot?.mainmast) void noteRunEnded(bot, run)
    },
  }
}
