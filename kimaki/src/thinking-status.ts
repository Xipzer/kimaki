// a live "thinking" status line while the root model reasons.
//
// Upstream drops reasoning (spec: "reasoning is never shown"), so at high
// thinking levels a thread shows only the typing indicator for 25-70 s
// (measured: Opus 5.5 max, first visible output p50 25.6 s vs 7.2 s default).
//
//   reducer (pure)                         executor (timers, Discord)
//   reasoning.started ─▶ start ───────────▶ clock starts; after SHOW_AFTER_MS post
//   reasoning.delta   ─▶ update (headline) ─▶   "-# thinking · 6s · <headline>",
//                                               edited every EDIT_EVERY_MS
//   reasoning.ended   ─▶ end ─────────────▶ shown: "-# thought for 31s · <headline>"
//                                           never shown: nothing
//
// The executor's timer drives the line, so models that stream no reasoning
// summary (most GPT steps) still show elapsed time.

import { asSubtext, textOnly, type UiMessage } from './format-parts.ts'

export const SHOW_AFTER_MS = 4_000
export const EDIT_EVERY_MS = 5_000
const BUFFER_CHARS = 4_000
const HEADLINE_CHARS = 140

// Reducer state of the open root reasoning block.
export type Thinking = { key: string; text: string; headline: string }

export type ThinkingEffect = { type: 'thinking'; key: string; phase: 'start' | 'update' | 'end' | 'tick'; headline: string }

// The latest **heading** of the summary (OpenAI style), else its latest sentence.
export function headline(text: string): string {
  const fromHeading = [...text.matchAll(/\*\*([^*\n]{3,})\*\*/g)].at(-1)?.[1]
  const pick = fromHeading ?? text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter((s) => s.length > 3).at(-1) ?? ''
  const clean = pick.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()
  return clean.length > HEADLINE_CHARS ? `${clean.slice(0, HEADLINE_CHARS - 1)}…` : clean
}

// --- reducer side (pure; `thinking` may be an immer draft)

export function thinkingStarted(key: string): { thinking: Thinking; effect: ThinkingEffect } {
  return { thinking: { key, text: '', headline: '' }, effect: { type: 'thinking', key, phase: 'start', headline: '' } }
}

export function thinkingDelta(thinking: Thinking, delta: string): ThinkingEffect | null {
  thinking.text = (thinking.text + delta).slice(-BUFFER_CHARS)
  const next = headline(thinking.text)
  if (next === thinking.headline) return null
  thinking.headline = next
  return { type: 'thinking', key: thinking.key, phase: 'update', headline: next }
}

export function thinkingEnded(thinking: Thinking, text: string | null): ThinkingEffect {
  const final = text ? headline(text.slice(-BUFFER_CHARS)) : thinking.headline
  return { type: 'thinking', key: thinking.key, phase: 'end', headline: final || thinking.headline }
}

// --- executor side

export function statusLine({ startedAt, now, headline: head, final }: { startedAt: number; now: number; headline: string; final: boolean }): UiMessage {
  const seconds = Math.max(1, Math.round((now - startedAt) / 1000))
  const label = final ? `thought for ${seconds}s` : `thinking · ${seconds}s`
  return textOnly(asSubtext(head ? `${label} · ${head}` : label))
}

type Line = { startedAt: number; headline: string; messageId: string | null; timer: ReturnType<typeof setTimeout> | null }

// One open line per key. `tick` is called back through the thread's FIFO queue
// so a status post never overtakes output queued before it.
export function createThinkingLines({
  now = Date.now,
  schedule = (fn: () => void, ms: number) => setTimeout(fn, ms),
  cancel = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  queueTick,
  post,
  edit,
}: {
  now?: () => number
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  cancel?: (timer: ReturnType<typeof setTimeout>) => void
  queueTick: (key: string) => void
  post: (message: UiMessage) => Promise<string | null>
  edit: (messageId: string, message: UiMessage) => Promise<void>
}) {
  const lines = new Map<string, Line>()
  const arm = (key: string, line: Line, ms: number) => {
    line.timer = schedule(() => {
      line.timer = null
      queueTick(key)
    }, ms)
  }
  return {
    async apply(effect: ThinkingEffect): Promise<void> {
      const line = lines.get(effect.key)
      if (effect.phase === 'start') {
        if (line) return
        const created: Line = { startedAt: now(), headline: '', messageId: null, timer: null }
        lines.set(effect.key, created)
        arm(effect.key, created, SHOW_AFTER_MS)
        return
      }
      if (!line) return
      if (effect.headline) line.headline = effect.headline
      if (effect.phase === 'update') return
      if (effect.phase === 'tick') {
        const message = statusLine({ startedAt: line.startedAt, now: now(), headline: line.headline, final: false })
        if (line.messageId) await edit(line.messageId, message)
        else line.messageId = await post(message)
        if (lines.get(effect.key) === line) arm(effect.key, line, EDIT_EVERY_MS)
        return
      }
      // end
      lines.delete(effect.key)
      if (line.timer) cancel(line.timer)
      if (line.messageId) await edit(line.messageId, statusLine({ startedAt: line.startedAt, now: now(), headline: line.headline, final: true }))
    },
    clear(): void {
      for (const line of lines.values()) if (line.timer) cancel(line.timer)
      lines.clear()
    },
  }
}
