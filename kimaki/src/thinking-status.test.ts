import type { V2Event } from '@opencode/client'
import { describe, expect, test } from 'vitest'

import { headline, thinkingDelta, thinkingEnded, thinkingStarted } from './thinking-status.ts'
import { effectLines, loadFixture, replay } from './test/replay.ts'

describe('headline', () => {
  test('latest bold heading (OpenAI summaries), else latest sentence (Claude)', () => {
    expect(headline('**Reading files**\n\nI look.\n\n**Calculating time for rows**\n\nThen...')).toBe('Calculating time for rows')
    expect(headline('First I check the config. Then I compare the two token addresses and approvals')).toBe('Then I compare the two token addresses and approvals')
    expect(headline('x'.repeat(300)).length).toBe(140)
    expect(headline('')).toBe('')
  })
})

describe('status line timing', () => {
  test('short blocks post nothing; long ones post after 4 s, edit every 5 s, finalize', () => {
    const thinking = thinkingStarted({ key: 'thinking:m:0', at: 0 })
    expect(thinkingDelta({ thinking, delta: '**Planning**', at: 1_000 })).toBe(null)
    expect(thinkingDelta({ thinking, delta: ' more', at: 4_500 })?.message.content).toBe('-# thinking · 5s · Planning')
    expect(thinkingDelta({ thinking, delta: ' **Checking tests**', at: 7_000 })).toBe(null)
    expect(thinkingDelta({ thinking, delta: '', at: 9_600 })?.message.content).toBe('-# thinking · 10s · Checking tests')
    expect(thinkingEnded({ thinking, text: null, at: 31_000 })).toEqual({
      type: 'status',
      key: 'thinking:m:0',
      final: true,
      message: { content: '-# thought for 31s · Checking tests', components: [] },
    })
    const quick = thinkingStarted({ key: 'thinking:m:1', at: 0 })
    thinkingDelta({ thinking: quick, delta: 'fast', at: 500 })
    expect(thinkingEnded({ thinking: quick, text: 'fast', at: 2_000 })).toBe(null)
  })
})

test('a long reasoning block in a recorded turn shows a live line before the answer', () => {
  const events = loadFixture('queue-parked.events.jsonl')
  const started = events.findIndex((event) => event.type === 'session.reasoning.started')
  const delta = events[events.findIndex((event) => event.type === 'session.reasoning.delta')]!
  const base = events[started]!.created
  // Stretch the recorded block to 12 s with deltas every 3 s.
  const stretched: V2Event[] = [1, 2, 3, 4].map((i) => ({ ...delta, id: `${delta.id}-${i}`, created: base + i * 3_000 }) as V2Event)
  const shifted = events.map((event, index) => (index > started && event.type !== 'session.reasoning.delta' && event.created > base ? ({ ...event, created: event.created + 12_000 } as V2Event) : event))
  const withDeltas = [...shifted.slice(0, started + 1), ...stretched, ...shifted.slice(started + 1).filter((event) => event.type !== 'session.reasoning.delta')]
  const lines = effectLines(replay({ events: withDeltas }).effects).filter((line) => line.startsWith('[status'))
  expect(lines).toMatchInlineSnapshot(`
    [
      "[status thinking:msg_0f203a843001C3vIwuaGEy2VtK:0] -# thinking · 6s · Answering about apple",
      "[status thinking:msg_0f203a843001C3vIwuaGEy2VtK:0] -# thinking · 12s · Answering about apple",
      "[status final thinking:msg_0f203a843001C3vIwuaGEy2VtK:0] -# thought for 13s · Answering about apple",
    ]
  `)
})
