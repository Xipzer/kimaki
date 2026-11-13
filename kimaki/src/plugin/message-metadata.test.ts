import { expect, test } from 'vitest'

import { createStoredMetadata } from './message-metadata.ts'

test('reads prompt metadata from the history once per new message', async () => {
  let reads = 0
  const messages: Array<{ id: string; type: string; metadata?: Record<string, unknown> }> = [
    { id: 'a', type: 'user', metadata: { discord: { username: 'tommy' } } },
    { id: 'b', type: 'assistant' },
    { id: 's', type: 'synthetic' },
  ]
  const stored = createStoredMetadata(async () => {
    reads++
    return messages
  })
  expect(await stored('ses', 'a')).toEqual({ discord: { username: 'tommy' } })
  expect(await stored('ses', 'a')).toEqual({ discord: { username: 'tommy' } })
  // A synthetic message has no metadata and is not looked up twice.
  expect(await stored('ses', 's')).toBe(undefined)
  expect(await stored('ses', 's')).toBe(undefined)
  expect(reads).toBe(2)
  messages.push({ id: 'c', type: 'user', metadata: { sinceAssistantMs: 5000 } })
  expect(await stored('ses', 'c')).toEqual({ sinceAssistantMs: 5000 })
  expect(await stored('ses', 'a')).toEqual({ discord: { username: 'tommy' } })
  expect(reads).toBe(3)
})

test('a failed history read adds nothing and is tried again', async () => {
  let fail = true
  const stored = createStoredMetadata(async () => {
    if (fail) throw new Error('unavailable')
    return [{ id: 'a', type: 'user', metadata: { sinceAssistantMs: 1 } }]
  })
  expect(await stored('ses', 'a')).toBe(undefined)
  fail = false
  expect(await stored('ses', 'a')).toEqual({ sinceAssistantMs: 1 })
})
