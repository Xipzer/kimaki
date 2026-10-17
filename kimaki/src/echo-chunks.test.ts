import { describe, expect, test } from 'vitest'
import { echoChunks } from './echo-chunks.ts'
import { formatEcho } from './queue.ts'

describe('echoChunks', () => {
  test('short text matches formatEcho', () => {
    expect(echoChunks({ username: 'xipz', text: 'hello there' })).toEqual([formatEcho({ username: 'xipz', text: 'hello there' })])
  })

  test('long text is split on word boundaries without losing words', () => {
    const words = Array.from({ length: 900 }, (_, i) => `word${i}`)
    const chunks = echoChunks({ username: 'xipz', text: words.join(' ') })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]!.startsWith('» **xipz:** ')).toBe(true)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1_900 + '» **xipz:** '.length)
    const rejoined = chunks.map((chunk, i) => (i === 0 ? chunk.replace('» **xipz:** ', '') : chunk)).join(' ')
    expect(rejoined.split(/\s+/)).toEqual(words)
  })

  test('prefers newlines and hard-cuts text without spaces', () => {
    expect(echoChunks({ username: null, text: `${'a'.repeat(30)}\n${'b'.repeat(30)}`, limit: 40 })).toEqual([`» **queued:** ${'a'.repeat(30)}`, 'b'.repeat(30)])
    expect(echoChunks({ username: 'u', text: 'x'.repeat(50), limit: 20 }).map((chunk) => chunk.replace('» **u:** ', '').length)).toEqual([20, 20, 10])
  })
})
