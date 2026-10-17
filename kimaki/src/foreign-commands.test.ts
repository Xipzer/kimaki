import { ApplicationCommandType, type APIApplicationCommand } from 'discord-api-types/v10'
import { describe, expect, test } from 'vitest'
import { isKimakiCommand, mergeForeignCommands, preservePatterns } from './foreign-commands.ts'

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

describe('mergeForeignCommands', () => {
  test('foreign commands are sent back without response-only fields', () => {
    const merged = mergeForeignCommands({ built: [body('abort'), body('build-agent')], fixedCount: 1, live: [live('abort'), live('old-agent'), live('assistant')] })
    expect(merged.kept).toEqual(['assistant'])
    expect(merged.commands).toMatchInlineSnapshot(`
      [
        {
          "description": "abort",
          "name": "abort",
        },
        {
          "description": "build-agent",
          "name": "build-agent",
        },
        {
          "default_member_permissions": null,
          "description": "assistant",
          "id": "id-assistant",
          "name": "assistant",
          "type": 1,
        },
      ]
    `)
  })

  test('dynamic commands give way to foreign ones; fixed ones always fit', () => {
    const built = [body('a'), body('b'), body('x-agent'), body('y-agent')]
    const merged = mergeForeignCommands({ built, fixedCount: 2, live: [live('assistant'), live('whisper-start')], limit: 5 })
    expect(merged.commands.map((command) => command.name)).toEqual(['a', 'b', 'x-agent', 'assistant', 'whisper-start'])
    expect(merged.skipped).toEqual(['y-agent'])
    const tight = mergeForeignCommands({ built, fixedCount: 2, live: [live('assistant'), live('whisper-start')], limit: 3 })
    expect(tight.commands.map((command) => command.name)).toEqual(['a', 'b', 'assistant'])
    expect(tight.droppedForeign).toEqual(['whisper-start'])
  })
})
