// A cold OpenCode location lists no agents, then only some, for a moment after
// it answers (OpenCode 2.2.7: integration.list returns before the location has loaded).

import { expect, test } from 'vitest'

import type { Bot } from './bot.ts'
import { agentSelection, channelDefaults, primaryAgents } from './sessions.ts'

const builtin = [
  { id: 'build', name: 'build', mode: 'primary', hidden: false },
  { id: 'plan', name: 'plan', mode: 'primary', hidden: false },
  { id: 'explore', name: 'explore', mode: 'subagent', hidden: false },
]
const late = { id: 'reviewer', name: 'Reviewer', mode: 'primary', hidden: false }

// agent.list answers with each list in turn, then keeps the last one.
function coldLocation(lists: Array<Array<{ id: string; name: string; mode: string; hidden: boolean }>>) {
  const calls: string[] = []
  const client = {
    integration: { list: async () => ({ data: [] }) },
    agent: {
      list: async () => {
        calls.push('agent.list')
        return { data: lists[Math.min(calls.length, lists.length) - 1] }
      },
    },
  }
  const bot = {
    opencode: { endpoint: { client } },
    db: { query: { channel_directories: { findFirst: async () => ({ directory: '/project', channel_agent: null }) } } },
  } as unknown as Bot
  return { bot, calls }
}

test('an agent missing while the location loads is selected once it is listed', async () => {
  const { bot, calls } = coldLocation([[], builtin])
  expect(await agentSelection(bot, { directory: '/project', agent: 'build' })).toEqual({ agent: 'build', model: null })
  expect(calls.length).toBe(2)

  // A user agent can appear after the built-in ones.
  const partial = coldLocation([[], builtin, [...builtin, late]])
  expect(await agentSelection(partial.bot, { directory: '/project', agent: 'reviewer' })).toEqual({ agent: 'reviewer', model: null })
  expect(partial.calls.length).toBe(3)
})

test('the channel default and the agent list wait for a loaded location', async () => {
  const defaults = coldLocation([[], [], builtin])
  expect(await channelDefaults(defaults.bot, 'channel')).toEqual({ projectDirectory: '/project', defaultAgent: 'build' })
  const listed = coldLocation([[], builtin])
  const agents = await primaryAgents(listed.bot, '/project')
  expect(agents instanceof Error ? agents : agents.map((agent) => agent.id)).toEqual(['build', 'plan'])
  // A loaded location is asked once.
  expect(listed.calls.length).toBe(2)
})

test('an agent that never appears fails after the wait', async () => {
  const { bot, calls } = coldLocation([builtin])
  const started = Date.now()
  const selected = await agentSelection(bot, { directory: '/project', agent: 'nope' })
  expect(selected).toBeInstanceOf(Error)
  expect(selected instanceof Error && selected.message).toContain('Agent `nope` is not available in this project')
  expect(Date.now() - started).toBeGreaterThanOrEqual(5_000)
  expect(calls.length).toBeGreaterThan(10)
}, 10_000)
