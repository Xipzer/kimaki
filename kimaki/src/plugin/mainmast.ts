// Timers of mainmast sessions (the coordinator of a mainmast channel), from
// the `mainmast` field of the marker the bot writes at session.create:
//
//   user prompt ─▶ armed ─▶ no model request for nudgeMs ─▶ "the user is away: any useful work?"
//   model request ──compactMs──▶ compact, while the warmed prompt cache still holds
//
// Quiet for nudgeMs means idle, so the nudge never lands in a running turn; it
// fires once per user prompt. compactMs is the OpenCode warming window: warm
// requests stop then, so compaction is the last cheap read of the cached prefix.
// Only the mainmast itself, never its threads or other sessions.
// TODO: let the mainmast compact worker sessions too (they keep their full history now).

import type { Plugin } from '@opencode/plugin'

export const IDLE_NUDGE_SOURCE = 'kimaki-idle'
// The whole answer of a nudge turn with nothing to do. The reducer drops it.
export const IDLE_REPLY = 'IDLE'

export function idleNudgeText(minutes: number) {
  return [
    '<system-reminder>',
    `The user has not replied for ${minutes} minutes. Is there useful work you can start now while the user is away, so no time is wasted?`,
    `If yes, start it now. If not, reply with exactly ${IDLE_REPLY} and nothing else.`,
    '</system-reminder>',
  ].join('\n')
}

type Timers = { nudgeMs: number; compactMs: number | null }
type Timer = ReturnType<typeof setTimeout>

// A small history is cheap to keep: compacting it only loses detail.
const MIN_COMPACT_CONTEXT_SHARE = 0.2

function readTimers(metadata: Readonly<Record<string, unknown>> | undefined): Timers | null {
  const kimaki = metadata?.['kimaki']
  const mainmast: unknown = kimaki && typeof kimaki === 'object' ? Reflect.get(kimaki, 'mainmast') : null
  if (!mainmast || typeof mainmast !== 'object') return null
  const nudgeMs: unknown = Reflect.get(mainmast, 'nudgeMs')
  const compactMs: unknown = Reflect.get(mainmast, 'compactMs')
  if (typeof nudgeMs !== 'number' || nudgeMs <= 0) return null
  return { nudgeMs, compactMs: typeof compactMs === 'number' && compactMs > 0 ? compactMs : null }
}

export async function registerMainmastTimers(ctx: Plugin.Context): Promise<() => void> {
  // Marker timers never change after create: one session.get per session, also for non-mainmast ones.
  const known = new Map<string, Promise<Timers | null>>()
  const armed = new Set<string>()
  const nudges = new Map<string, Timer>()
  const compactions = new Map<string, Timer>()

  function timers(sessionID: string): Promise<Timers | null> {
    const cached = known.get(sessionID)
    if (cached) return cached
    const found = ctx.session.get({ sessionID }).then((session) => (session.parentID ? null : readTimers(session.metadata)), () => null)
    known.set(sessionID, found)
    return found
  }

  // The last request used at least MIN_COMPACT_CONTEXT_SHARE of the model's context window.
  async function worthCompacting(sessionID: string, model: { providerID: string; id: string }): Promise<boolean> {
    const [messages, models] = await Promise.all([
      ctx.session.context({ sessionID }),
      ctx.model.list({ location: { directory: ctx.location.directory } }),
    ])
    const last = messages.findLast((message) => message.type === 'assistant' && message.tokens)
    const tokens = last?.type === 'assistant' && last.tokens ? last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write : 0
    const limit = models.data.find((candidate) => candidate.providerID === model.providerID && candidate.id === model.id)?.limit.context
    return !limit || tokens >= limit * MIN_COMPACT_CONTEXT_SHARE
  }

  function schedule(map: Map<string, Timer>, sessionID: string, ms: number, run: () => Promise<unknown>) {
    clearTimeout(map.get(sessionID))
    const timer = setTimeout(() => {
      map.delete(sessionID)
      // Plugins stay silent: a failed nudge or compaction only loses that one.
      void run().catch(() => undefined)
    }, ms)
    timer.unref?.()
    map.set(sessionID, timer)
  }

  await ctx.session.hook('prompt', async (event) => {
    if (await timers(event.sessionID)) armed.add(event.sessionID)
  })
  // Every model request of the session: the session is not idle yet, and the warming window moves.
  await ctx.session.hook('context', async (event) => {
    const found = await timers(event.sessionID)
    if (!found) return
    const { sessionID } = event
    if (armed.has(sessionID)) {
      schedule(nudges, sessionID, found.nudgeMs, async () => {
        armed.delete(sessionID)
        await ctx.session.synthetic({ sessionID, text: idleNudgeText(Math.round(found.nudgeMs / 60_000)), delivery: 'queue', metadata: { source: IDLE_NUDGE_SOURCE } })
      })
    }
    if (!found.compactMs) return
    const model = { providerID: event.model.providerID, id: event.model.id }
    schedule(compactions, sessionID, found.compactMs, async () => {
      if (!(await worthCompacting(sessionID, model))) return
      await ctx.session.compact({ sessionID, delivery: 'queue' })
    })
  })

  return () => {
    for (const timer of [...nudges.values(), ...compactions.values()]) clearTimeout(timer)
    nudges.clear()
    compactions.clear()
    armed.clear()
    known.clear()
  }
}
