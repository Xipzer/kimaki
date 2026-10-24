// Timers of mainmast sessions (the coordinator of a mainmast channel), from
// the `mainmast` field of its marker that the bot writes at session.create:
//
//   user prompt ──nudgeMs──▶ "the user is away: any useful work?" (once per prompt)
//   model request ──compactMs──▶ compact, while the warmed prompt cache still holds
//
// compactMs is the OpenCode warming window: warm requests stop then, so the
// compaction request is the last cheap read of the cached prefix. Only the
// mainmast itself, never its threads or other sessions.
// TODO: let the mainmast compact worker sessions too (they keep their full history now).

import type { Plugin } from '@opencode/plugin'

export const IDLE_NUDGE_SOURCE = 'kimaki-idle'

export function idleNudgeText(minutes: number) {
  return [
    '<system-reminder>',
    `The user has not replied for ${minutes} minutes. Is there useful work you can start now while the user is away, so no time is wasted?`,
    'If yes, start it now. If not, reply with nothing at all: no text, no tool calls.',
    '</system-reminder>',
  ].join('\n')
}

type Timers = { nudgeMs: number; compactMs: number | null }

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
  const nudges = new Map<string, ReturnType<typeof setTimeout>>()
  const compactions = new Map<string, ReturnType<typeof setTimeout>>()

  async function timers(sessionID: string): Promise<Timers | null> {
    const session = await ctx.session.get({ sessionID }).catch(() => null)
    if (!session || session.parentID) return null
    return readTimers(session.metadata)
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

  function schedule(map: Map<string, ReturnType<typeof setTimeout>>, sessionID: string, ms: number, run: () => Promise<unknown>) {
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
    const found = await timers(event.sessionID)
    if (!found) return
    schedule(nudges, event.sessionID, found.nudgeMs, () =>
      ctx.session.synthetic({
        sessionID: event.sessionID,
        text: idleNudgeText(Math.round(found.nudgeMs / 60_000)),
        delivery: 'queue',
        metadata: { source: IDLE_NUDGE_SOURCE },
      }),
    )
  })
  // Every model request of the session moves the end of the warming window.
  await ctx.session.hook('context', async (event) => {
    const found = await timers(event.sessionID)
    if (!found?.compactMs) return
    const model = { providerID: event.model.providerID, id: event.model.id }
    schedule(compactions, event.sessionID, found.compactMs, async () => {
      if (!(await worthCompacting(event.sessionID, model))) return
      await ctx.session.compact({ sessionID: event.sessionID, delivery: 'queue' })
    })
  })

  return () => {
    for (const timer of [...nudges.values(), ...compactions.values()]) clearTimeout(timer)
    nudges.clear()
    compactions.clear()
  }
}
