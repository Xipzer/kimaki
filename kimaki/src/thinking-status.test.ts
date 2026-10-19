import type { V2Event } from '@opencode/client'
import { describe, expect, test } from 'vitest'

import { createThinkingLines, headline, thinkingDelta, thinkingEnded, thinkingStarted, type ThinkingEffect } from './thinking-status.ts'
import { effectLines, loadFixture, replay } from './test/replay.ts'

describe('headline', () => {
  test('latest bold heading (OpenAI summaries), else latest sentence (Claude)', () => {
    expect(headline('**Reading files**\n\nI look.\n\n**Calculating time for rows**\n\nThen...')).toBe('Calculating time for rows')
    expect(headline('First I check the config. Then I compare the two token addresses and approvals')).toBe('Then I compare the two token addresses and approvals')
    expect(headline('x'.repeat(300)).length).toBe(140)
    expect(headline('')).toBe('')
  })
})

test('reducer side emits start, headline changes only, and end', () => {
  const { thinking, effect } = thinkingStarted('thinking:m:0')
  expect(effect.phase).toBe('start')
  expect(thinkingDelta(thinking, '**Planning**')?.headline).toBe('Planning')
  expect(thinkingDelta(thinking, ' still planning')).toBe(null)
  expect(thinkingEnded(thinking, null)).toEqual({ type: 'thinking', key: 'thinking:m:0', phase: 'end', headline: 'Planning' })
})

describe('executor lines', () => {
  function harness() {
    let clock = 0
    const timers: Array<{ at: number; fn: () => void; id: number }> = []
    const log: string[] = []
    let ids = 0
    const queued: string[] = []
    const lines = createThinkingLines({
      now: () => clock,
      schedule: (fn, ms) => {
        const id = ++ids
        timers.push({ at: clock + ms, fn, id })
        return id as unknown as ReturnType<typeof setTimeout>
      },
      cancel: (timer) => {
        const index = timers.findIndex((entry) => entry.id === (timer as unknown as number))
        if (index >= 0) timers.splice(index, 1)
      },
      queueTick: (key) => void queued.push(key),
      post: async (message) => {
        log.push(`post ${message.content}`)
        return 'msg1'
      },
      edit: async (id, message) => void log.push(`edit ${id} ${message.content}`),
    })
    const advance = async (to: number) => {
      clock = to
      for (const timer of timers.filter((entry) => entry.at <= to)) {
        timers.splice(timers.indexOf(timer), 1)
        timer.fn()
      }
      while (queued.length) await lines.apply({ type: 'thinking', key: queued.shift()!, phase: 'tick', headline: '' })
    }
    const apply = (effect: Omit<ThinkingEffect, 'type'>) => lines.apply({ type: 'thinking', ...effect })
    return { log, advance, apply }
  }

  test('long block: posts at 4 s, edits every 5 s even without a summary, finalizes', async () => {
    const { log, advance, apply } = harness()
    await apply({ key: 'k', phase: 'start', headline: '' })
    await advance(3_000)
    expect(log).toEqual([])
    await advance(4_000)
    await apply({ key: 'k', phase: 'update', headline: 'Checking tests' })
    await advance(9_000)
    await apply({ key: 'k', phase: 'end', headline: 'Checking tests' })
    await advance(30_000)
    expect(log).toEqual([
      'post -# thinking · 4s',
      'edit msg1 -# thinking · 9s · Checking tests',
      'edit msg1 -# thought for 9s · Checking tests',
    ])
  })

  test('short block posts nothing', async () => {
    const { log, advance, apply } = harness()
    await apply({ key: 'k', phase: 'start', headline: '' })
    await advance(2_000)
    await apply({ key: 'k', phase: 'end', headline: 'quick' })
    await advance(20_000)
    expect(log).toEqual([])
  })
})

test('the reducer emits thinking effects for a recorded reasoning block', () => {
  const events: V2Event[] = loadFixture('queue-parked.events.jsonl')
  const lines = effectLines(replay({ events }).effects).filter((line) => line.startsWith('[thinking'))
  expect(lines).toMatchInlineSnapshot(`
    [
      "[thinking start thinking:msg_0f203a843001C3vIwuaGEy2VtK:0]",
      "[thinking update thinking:msg_0f203a843001C3vIwuaGEy2VtK:0] Answering about apple",
      "[thinking end thinking:msg_0f203a843001C3vIwuaGEy2VtK:0] Answering about apple",
    ]
  `)
})
