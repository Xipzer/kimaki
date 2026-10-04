// Tests merging Kimaki slash commands with foreign commands that share the bot application.

import { describe, expect, test, vi } from 'vitest'

// The agent command module pulls in the opencode/model stack, which these pure tests do not need.
vi.mock('./commands/agent.js', () => ({
  sanitizeAgentName: (name: string) => name,
  buildQuickAgentCommandDescription: () => '',
}))

import {
  ApplicationCommandType,
  type APIApplicationCommand,
  type RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js'
import {
  isKimakiOwnedCommand,
  mergeWithForeignCommands,
  parsePreservePatterns,
} from './discord-command-registration.js'

const owned = (name: string): RESTPostAPIApplicationCommandsJSONBody => ({ name, description: name })

const existing = (name: string): APIApplicationCommand => ({
  id: `id-${name}`,
  application_id: 'app',
  guild_id: 'guild',
  version: 'v1',
  type: ApplicationCommandType.ChatInput,
  name,
  name_localized: name,
  description: `${name} desc`,
  description_localized: `${name} desc`,
  default_member_permissions: null,
  default_permission: true,
  options: [],
})

describe('isKimakiOwnedCommand', () => {
  const ownedNames = new Set(['resume', 'plan-agent'])
  const check = (name: string, preserve = '') =>
    isKimakiOwnedCommand({ name, ownedNames, preservePatterns: parsePreservePatterns(preserve) })

  test('classifies current, dynamic, legacy, and foreign names', () => {
    expect(
      ['resume', 'plan-agent', 'old-agent', 'deploy-cmd', 'brainstorm-skill', 'x-mcp-prompt', 'toggle-worktrees', 'wendy', 'wendy-status', 'whisper-setup', 'agent-tools']
        .map((n) => `${n}: ${check(n)}`),
    ).toMatchInlineSnapshot(`
      [
        "resume: true",
        "plan-agent: true",
        "old-agent: true",
        "deploy-cmd: true",
        "brainstorm-skill: true",
        "x-mcp-prompt: true",
        "toggle-worktrees: true",
        "wendy: false",
        "wendy-status: false",
        "whisper-setup: false",
        "agent-tools: false",
      ]
    `)
  })

  test('KIMAKI_PRESERVE_COMMANDS overrides patterns but not current names', () => {
    expect(check('deploy-cmd', 'deploy-cmd')).toBe(false)
    expect(check('foo-skill', ' other , *-skill ')).toBe(false)
    expect(check('toggle-worktrees', 'toggle-*')).toBe(false)
    expect(check('plan-agent', '*-agent')).toBe(true)
  })

  test('parsePreservePatterns escapes regex characters', () => {
    expect(parsePreservePatterns('a.b').some((p) => p.test('axb'))).toBe(false)
    expect(parsePreservePatterns(undefined)).toEqual([])
  })
})

describe('mergeWithForeignCommands', () => {
  test('keeps foreign commands with response-only fields stripped and replaces owned ones', () => {
    const result = mergeWithForeignCommands({
      owned: [owned('resume'), owned('plan-agent')],
      existing: [existing('resume'), existing('old-cmd'), existing('wendy')],
    })
    expect(result.foreign).toEqual(['wendy'])
    expect(result.body).toMatchInlineSnapshot(`
      [
        {
          "description": "resume",
          "name": "resume",
        },
        {
          "description": "plan-agent",
          "name": "plan-agent",
        },
        {
          "default_member_permissions": null,
          "description": "wendy desc",
          "id": "id-wendy",
          "name": "wendy",
          "options": [],
          "type": 1,
        },
      ]
    `)
  })

  test('trims lowest-priority owned commands first to make room for foreign ones', () => {
    const result = mergeWithForeignCommands({
      owned: ['resume', 'abort', 'a-agent', 'b-cmd', 'c-skill'].map(owned),
      existing: ['wendy', 'wendy-wake'].map(existing),
      reservedOwnedCount: 2,
      max: 5,
    })
    expect(result.body.map((c) => c.name)).toEqual(['resume', 'abort', 'a-agent', 'wendy', 'wendy-wake'])
    expect(result.trimmedOwned).toEqual(['b-cmd', 'c-skill'])
    expect(result.droppedForeign).toEqual([])
  })

  test('reserved static commands win over foreign ones when both cannot fit', () => {
    const result = mergeWithForeignCommands({
      owned: ['resume', 'abort', 'a-agent'].map(owned),
      existing: ['w1', 'w2', 'w3'].map(existing),
      reservedOwnedCount: 2,
      max: 3,
    })
    expect(result.body.map((c) => c.name)).toEqual(['resume', 'abort', 'w1'])
    expect(result.trimmedOwned).toEqual(['a-agent'])
    expect(result.droppedForeign).toEqual(['w2', 'w3'])
  })

  test('with no owned commands only foreign commands remain (global cleanup)', () => {
    const result = mergeWithForeignCommands({
      owned: [],
      existing: ['session', 'plan-agent', 'wendy'].map(existing),
    })
    expect(result.body.map((c) => c.name)).toEqual(['wendy'])
  })
})
