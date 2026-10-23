import { expect, test } from 'vitest'

import { BUILTIN_SKILL_IDS, disabledSkillRules, parseDisabledPromptSections, parseDisabledSkills, PROMPT_SECTIONS, readBuiltinSkills } from './builtin-skills.ts'
import { baseInstructions } from './system-prompt.ts'

test('every built-in skill file parses', async () => {
  const skills = await readBuiltinSkills()
  if (skills instanceof Error) throw skills
  expect(skills.map((skill) => skill.id)).toEqual([...BUILTIN_SKILL_IDS])
  for (const skill of skills) {
    expect(skill.description, skill.id).toContain('Only for Kimaki Discord sessions')
    expect(skill.content.startsWith('# '), skill.id).toBe(true)
  }
})

test('--disable-skills accepts all, a list, and rejects unknown ids', () => {
  expect(parseDisabledSkills(undefined)).toEqual([])
  expect(parseDisabledSkills('kimaki-tunnel, kimaki-debug')).toEqual(['kimaki-tunnel', 'kimaki-debug'])
  expect(parseDisabledSkills('all')).toEqual([...BUILTIN_SKILL_IDS])
  expect(parseDisabledSkills('tunnel')).toBeInstanceOf(Error)
  expect(disabledSkillRules(['kimaki-tunnel'])).toMatchInlineSnapshot(`
    [
      {
        "action": "skill",
        "effect": "deny",
        "resource": "kimaki-tunnel",
      },
    ]
  `)
})

test('--disable-prompt removes exactly the headings of each section', () => {
  expect(parseDisabledPromptSections(['critique-diffs,discord-callouts', 'search-result-urls'])).toEqual(['critique-diffs', 'discord-callouts', 'search-result-urls'])
  expect(parseDisabledPromptSections(['critique'])).toBeInstanceOf(Error)
  const input = { sessionId: 'ses_1', threadId: '2', channelId: '3', guildId: '4', userId: '5', dataDir: '/data', channelTopic: null, agents: [], parentSessionId: null }
  const headings = (text: string) => text.split('\n').filter((line) => line.startsWith('## '))
  const full = headings(baseInstructions(input))
  const removed = Object.fromEntries(PROMPT_SECTIONS.map((section) => {
    const kept = new Set(headings(baseInstructions({ ...input, disabled: [section] })))
    return [section, full.filter((heading) => !kept.has(heading))]
  }))
  expect(removed).toMatchInlineSnapshot(`
    {
      "action-buttons": [
        "## action buttons",
        "## ending conversations with options",
      ],
      "critique-diffs": [
        "## showing diffs",
      ],
      "cross-project-commands": [
        "## cross-project commands",
      ],
      "diagrams": [
        "## diagrams",
      ],
      "discord-callouts": [
        "## Callouts in Kimaki Discord",
        "## Tests not fully green",
      ],
      "discord-permissions": [
        "## permissions",
      ],
      "file-upload-requests": [
        "## requesting files from the user",
      ],
      "kimaki-debugging": [
        "## debugging kimaki issues",
      ],
      "markdown-formatting": [
        "## markdown formatting",
      ],
      "search-result-urls": [
        "## URLs in search results",
      ],
      "session-abort": [
        "## aborting a session",
      ],
      "session-sleep": [
        "## sleeping the session",
      ],
      "waiting-sessions": [
        "## waiting for a session to finish",
      ],
    }
  `)
  expect(headings(baseInstructions({ ...input, disabled: [...PROMPT_SECTIONS] }))).toMatchInlineSnapshot(`
    [
      "## Discord output",
      "## shell tool",
      "## commit messages",
      "## uploading files to discord",
      "## generating audio from text",
      "## archiving the current thread",
      "## updating the session title",
      "## discord user mentions",
      "## starting new sessions from CLI",
      "## scheduled sends and routines",
      "## reading other sessions",
    ]
  `)
})
