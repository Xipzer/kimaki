import { expect, test } from 'vitest'

import { remoteSendArgs } from './cli/schedule.ts'
import { linksBlock, mentionedIds, sourceLine } from './session-links.ts'

test('a prompt names sessions by ID and threads by link or mention, once each', () => {
  expect(mentionedIds([
    'Question from https://discord.com/channels/111111111111111111/222222222222222222 (session ses_0123456789abcdefABCDEFghij).',
    'Also <#333333333333333333>, ses_0123456789abcdefABCDEFghij again, and ses_short is not an ID.',
  ].join('\n'))).toEqual({
    sessionIds: ['ses_0123456789abcdefABCDEFghij'],
    threadIds: ['222222222222222222', '333333333333333333'],
  })
})

test('the links entry lists the most recent links with how to reach them', () => {
  const links = Array.from({ length: 10 }, (_, i) => ({
    sessionId: `ses_${String(i).padStart(26, '0')}`,
    threadId: i % 2 === 0 ? `44444444444444444${String(i).padStart(2, '0')}` : null,
    machine: i === 3 ? 'Projector' : null,
    title: i === 1 ? null : `Specialist ${i}`,
    source: 'send',
    lastContactAt: new Date(Date.UTC(2026, 10, 24 - i)),
  }))
  expect(linksBlock([])).toBe('')
  expect(linksBlock(links)).toMatchInlineSnapshot(`
    "## Linked sessions

    Your liaisons: sessions you worked with. Ask them instead of redoing their work. They survive compaction of this session.
    - Specialist 0 · thread 4444444444444444400 · session ses_00000000000000000000000000 · last contact 2026-11-24
    - untitled · session ses_00000000000000000000000001 · last contact 2026-11-23
    - Specialist 2 · thread 4444444444444444402 · session ses_00000000000000000000000002 · last contact 2026-11-22
    - Specialist 3 · session ses_00000000000000000000000003 · on Projector · last contact 2026-11-21
    - Specialist 4 · thread 4444444444444444404 · session ses_00000000000000000000000004 · last contact 2026-11-20
    - Specialist 5 · session ses_00000000000000000000000005 · last contact 2026-11-19
    - Specialist 6 · thread 4444444444444444406 · session ses_00000000000000000000000006 · last contact 2026-11-18
    - Specialist 7 · session ses_00000000000000000000000007 · last contact 2026-11-17

    Message one with \`kimaki send --thread <thread> --prompt '... queue' --agent <current_agent>\` (or \`--session <session>\`); the \`queue\` suffix waits for its current run. One on another machine: add \`--host <ssh alias of that machine>\`.
    Fix the list with \`kimaki session links --add <id>\` or \`--remove <id>\`."
  `)
})

test('a prompt from another machine names its session in a stable line', () => {
  expect([
    sourceLine({ sessionId: 'ses_0123456789abcdefABCDEFghij', threadId: '222222222222222222', machine: 'Printer' }),
    sourceLine({ threadId: '222222222222222222' }),
  ]).toEqual([
    '-# from Printer · thread 222222222222222222 · session ses_0123456789abcdefABCDEFghij',
    '-# from another machine · thread 222222222222222222',
  ])
})

test('send --host forwards the send without --host, --data-dir or stale --from-* and names this session', () => {
  const argv = ['node', 'kimaki', 'send', '--host', 'projector', '--thread', '333333333333333333', '--data-dir=/tmp/x', '--from-session', 'ses_old', '--prompt', "it's done. queue", '--agent', 'build']
  expect(remoteSendArgs({ argv, from: { session: 'ses_0123456789abcdefABCDEFghij', thread: '222222222222222222', machine: 'Printer' } })).toEqual([
    '--thread', '333333333333333333', '--prompt', "it's done. queue", '--agent', 'build',
    '--from-session', 'ses_0123456789abcdefABCDEFghij', '--from-thread', '222222222222222222', '--from-machine', 'Printer',
  ])
})
