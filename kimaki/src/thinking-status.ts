// Fork: a live "thinking" status line while the root model reasons.
//
// Upstream drops reasoning (spec: "reasoning is never shown"), so at high
// thinking levels a thread shows nothing but the typing indicator for 25-70 s
// (measured: Opus 5.5 max, first visible output p50 25.6 s vs 7.2 s default).
// OpenCode streams reasoning summaries (`session.reasoning.delta`), so:
//
//   reasoning.started ─▶ remember the block
//   reasoning.delta   ─▶ after SHOW_AFTER_MS: post "-# thinking · 6s · <headline>"
//                        then edit it at most every EDIT_EVERY_MS
//   reasoning.ended   ─▶ final edit "-# thought for 31s · <headline>" (only if shown)
//
// Short blocks post nothing. Pure: timing comes from event timestamps.

import { asSubtext, textOnly } from './format-parts.ts'
import type { UiMessage } from './format-parts.ts'

export const SHOW_AFTER_MS = 4_000
export const EDIT_EVERY_MS = 5_000
const BUFFER_CHARS = 4_000
const HEADLINE_CHARS = 140

export type Thinking = {
  key: string
  startedAt: number
  // Last post or edit; null until the line is posted.
  shownAt: number | null
  text: string
}

export type ThinkingEffect =
  | { type: 'status'; key: string; message: UiMessage; final: boolean }

// The latest **heading** of the summary (OpenAI style), else its latest sentence.
export function headline(text: string): string {
  const headings = [...text.matchAll(/\*\*([^*\n]{3,})\*\*/g)]
  const fromHeading = headings.at(-1)?.[1]
  const pick = fromHeading ?? text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter((s) => s.length > 3).at(-1) ?? ''
  const clean = pick.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()
  return clean.length > HEADLINE_CHARS ? `${clean.slice(0, HEADLINE_CHARS - 1)}…` : clean
}

function line({ thinking, now, final }: { thinking: Thinking; now: number; final: boolean }): UiMessage {
  const seconds = Math.max(1, Math.round((now - thinking.startedAt) / 1000))
  const head = headline(thinking.text)
  const label = final ? `thought for ${seconds}s` : `thinking · ${seconds}s`
  return textOnly(asSubtext(head ? `${label} · ${head}` : label))
}

export function thinkingStarted({ key, at }: { key: string; at: number }): Thinking {
  return { key, startedAt: at, shownAt: null, text: '' }
}

// Mutates `thinking` (an immer draft in the reducer) and returns the effect to emit, if any.
export function thinkingDelta({ thinking, delta, at }: { thinking: Thinking; delta: string; at: number }): ThinkingEffect | null {
  thinking.text = (thinking.text + delta).slice(-BUFFER_CHARS)
  if (thinking.shownAt === null) {
    if (at - thinking.startedAt < SHOW_AFTER_MS) return null
  } else if (at - thinking.shownAt < EDIT_EVERY_MS) {
    return null
  }
  thinking.shownAt = at
  return { type: 'status', key: thinking.key, message: line({ thinking, now: at, final: false }), final: false }
}

export function thinkingEnded({ thinking, text, at }: { thinking: Thinking; text: string | null; at: number }): ThinkingEffect | null {
  if (text) thinking.text = text.slice(-BUFFER_CHARS)
  if (thinking.shownAt === null) return null
  return { type: 'status', key: thinking.key, message: line({ thinking, now: at, final: true }), final: true }
}
