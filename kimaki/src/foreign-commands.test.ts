import { ApplicationCommandType, type APIApplicationCommand } from 'discord-api-types/v10'
import { describe, expect, test } from 'vitest'
import { isKimakiCommand, keepForeignCommands, preservePatterns } from './foreign-commands.ts'

const body = (name: string) => ({ name, description: name })
const live = (name: string): APIApplicationCommand => ({
  id: `id-${name}`,
  application_id: 'app',
  guild_id: 'guild',
  version: 'v1',
  type: ApplicationCommandType.ChatInput,
  name,
  description: name,
  default_member_permissions: null,
  name_localized: name,
})

describe('isKimakiCommand', () => {
  const current = new Set(['abort', 'build-agent'])
  test('current, dynamic and legacy names are Kimaki, others are foreign', () => {
    expect(['abort', 'plan-agent', 'deploy-cmd', 'review-skill', 'transcription-url', 'toggle-worktrees'].map((name) => isKimakiCommand({ name, current }))).toEqual([true, true, true, true, true, true])
    expect(['assistant', 'assistant-status', 'whisper-start', 'whisper-setup'].map((name) => isKimakiCommand({ name, current }))).toEqual([false, false, false, false])
  })
  test('KIMAKI_PRESERVE_COMMANDS keeps look-alikes but never current names', () => {
    const preserve = preservePatterns('deploy-cmd, build-*')
    expect(isKimakiCommand({ name: 'deploy-cmd', current, preserve })).toBe(false)
    expect(isKimakiCommand({ name: 'build-agent', current, preserve })).toBe(true)
  })
})

describe('keepForeignCommands', () => {
  test('only foreign commands are kept; old Kimaki ones are left to the diff', () => {
    const kept = keepForeignCommands({ built: [body('abort'), body('build-agent')], fixedCount: 1, live: [live('abort'), live('old-agent'), live('assistant')] })
    expect(kept).toEqual({ wanted: [body('abort'), body('build-agent')], kept: ['assistant'], skipped: [], droppedForeign: [] })
  })

  test('dynamic commands give way to foreign ones; fixed ones always fit', () => {
    const built = [body('a'), body('b'), body('x-agent'), body('y-agent')]
    const kept = keepForeignCommands({ built, fixedCount: 2, live: [live('assistant'), live('whisper-start')], limit: 5 })
    expect([kept.wanted.map((command) => command.name), kept.kept, kept.skipped]).toEqual([['a', 'b', 'x-agent'], ['assistant', 'whisper-start'], ['y-agent']])
    const tight = keepForeignCommands({ built, fixedCount: 2, live: [live('assistant'), live('whisper-start')], limit: 3 })
    expect([tight.wanted.map((command) => command.name), tight.kept, tight.droppedForeign]).toEqual([['a', 'b'], ['assistant'], ['whisper-start']])
  })
})
