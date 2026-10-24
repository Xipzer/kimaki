// Mainmast channels: the channel is the conversation of one long session, it
// starts worker threads with `kimaki send --parent-session`, and a finished
// worker wakes it with a <session-finished> note.

import fs from 'node:fs'
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { BotHandle } from './main.ts'
import { mainmastTimers } from './mainmast.ts'
import { send } from './prompt.ts'
import {
  TEST_USER_ID,
  scriptedTurn,
  seedProjectChannel,
  startOpencodeTestServer,
  startTestBot,
  startTwin,
  tempDataDir,
  textParts,
  waitFor,
  waitForFooter,
  warmUp,
  type OpencodeTestServer,
  type TestTwin,
} from './test/harness.ts'

let server: OpencodeTestServer
let twin: TestTwin
let bot: BotHandle
const dataDir = tempDataDir()

beforeAll(async () => {
  // The twin first: the delegating matcher needs its channel ID.
  twin = await startTwin()
  server = await startOpencodeTestServer({
      matchers: [
        { id: 'hello', priority: 100, when: { latestUserTextIncludes: 'hello-marker' }, then: { parts: textParts('Hello from the mainmast.') } },
        // The mainmast delegates: one shell call to `kimaki send`, then a short line.
        ...scriptedTurn({
          marker: 'delegate-marker',
          steps: [{
            id: 'call-send-worker',
            tool: 'shell',
            input: {
              command: `kimaki send --channel ${twin.channelId} --name 'Worker task' --prompt 'worker-marker do the job' --parent-session "$OPENCODE_SESSION_ID"`,
              description: 'Start the worker thread',
              hasSideEffect: true,
            },
          }],
          finalText: 'Started a worker for it.',
        }),
        // The default: the mainmast waits for the worker in the same shell call.
        ...scriptedTurn({
          marker: 'waitjob-marker',
          steps: [{
            id: 'call-send-wait',
            tool: 'shell',
            input: {
              command: `kimaki send --channel ${twin.channelId} --name 'Waited task' --prompt 'waited-worker-marker do the job' --parent-session "$OPENCODE_SESSION_ID" --wait`,
              description: 'Run the worker and wait',
              hasSideEffect: true,
            },
          }],
          finalText: 'The waited worker is done.',
        }),
        { id: 'waited-worker', priority: 100, when: { latestUserTextIncludes: 'waited-worker-marker' }, then: { parts: textParts('Waited job done.') } },
        // Slow enough that the delegating run ends first: the note then wakes an idle mainmast.
        { id: 'worker', priority: 100, when: { latestUserTextIncludes: 'worker-marker' }, then: { parts: textParts('Job done in the worker.'), defaultPartDelayMs: 300 } },
        { id: 'btw', priority: 100, when: { latestUserTextIncludes: 'btw-marker' }, then: { parts: textParts('Side answer.') } },
        { id: 'side', priority: 100, when: { latestUserTextIncludes: 'side-marker' }, then: { parts: textParts('Side check done.') } },
        // The silent note of the side thread is in the history only when it arrived.
        { id: 'recap-seen', priority: 200, when: { latestUserTextIncludes: 'recap-marker', rawPromptIncludes: 'Side check done.' }, then: { parts: textParts('A side thread finished meanwhile.') } },
        { id: 'recap-unseen', priority: 150, when: { latestUserTextIncludes: 'recap-marker' }, then: { parts: textParts('Nothing new.') } },
        { id: 'woken', priority: 300, when: { latestUserTextIncludes: '<session-finished' }, then: { parts: textParts('The worker finished the job.') } },
      ],
  })
  await seedProjectChannel({ dataDir, channelId: twin.channelId, guildId: twin.discord.guildId, directory: server.projectDirectory })
  await warmUp({ server })
  bot = await startTestBot({ dataDir, twin, server, mainmast: true, mainmastTimers: { nudgeMs: 3_600_000, compactMs: null } })
}, 60_000)

afterAll(async () => {
  await bot?.stop()
  await twin?.stop()
  await server?.stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('channel messages go to one session that replies in the channel', async () => {
  const { discord, channelId } = twin
  await discord.channel(channelId).user(TEST_USER_ID).sendMessage({ content: 'Say hi hello-marker' })
  await waitForFooter({ discord, threadId: channelId })
  await discord.channel(channelId).user(TEST_USER_ID).sendMessage({ content: 'Again hello-marker' })
  await waitForFooter({ discord, threadId: channelId, count: 2 })

  expect(await discord.channel(channelId).text()).toMatchInlineSnapshot(`
    "--- from: user (tommy)
    Say hi hello-marker
    --- from: assistant (TestBot)
    -# *using deterministic-provider/deterministic-v2 ⋅ build*
    Hello from the mainmast.
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*
    --- from: user (tommy)
    Again hello-marker
    --- from: assistant (TestBot)
    Hello from the mainmast.
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
  `)
  expect(await discord.channel(channelId).getThreads()).toHaveLength(0)
})

test('a worker started with --parent-session gets a thread and wakes the mainmast when done', async () => {
  const { discord, channelId } = twin
  const footers = (await discord.channel(channelId).getMessages()).filter((message) => message.content.startsWith('-# *project'))
  await discord.channel(channelId).user(TEST_USER_ID).sendMessage({ content: 'Fix it delegate-marker' })
  const thread = await discord.channel(channelId).waitForThread({ timeout: 8_000 })
  await waitForFooter({ discord, threadId: thread.id })
  await waitForFooter({ discord, threadId: channelId, count: footers.length + 1 })
  await waitFor({
    label: 'woken reply',
    check: async () => (await discord.channel(channelId).text()).includes('The worker finished the job.') || null,
  })
  await waitForFooter({ discord, threadId: channelId, count: footers.length + 2 })

  expect((await discord.channel(channelId).text()).replaceAll(thread.id, 'worker-thread')).toMatchInlineSnapshot(`
    "--- from: user (tommy)
    Say hi hello-marker
    --- from: assistant (TestBot)
    -# *using deterministic-provider/deterministic-v2 ⋅ build*
    Hello from the mainmast.
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*
    --- from: user (tommy)
    Again hello-marker
    --- from: assistant (TestBot)
    Hello from the mainmast.
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*
    --- from: user (tommy)
    Fix it delegate-marker
    --- from: assistant (TestBot)
    -# ┣ shell _Start the worker thread_

    Started a worker for it.
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*
    -# Worker task finished: <#worker-thread>

    The worker finished the job.
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
  `)
  expect(await discord.thread(thread.id).text()).toMatchInlineSnapshot(`
    "--- from: assistant (TestBot)
    » **CLI:** worker-marker do the job
    -# *using deterministic-provider/deterministic-v2 ⋅ build*
    Job done in the worker.
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
  `)
  expect(thread.name).toBe('Worker task')
})

test('a worker started with --wait answers through the wait, with no note', async () => {
  const { discord, channelId } = twin
  const footers = (await discord.channel(channelId).getMessages()).filter((message) => message.content.startsWith('-# *project'))
  const threads = (await discord.channel(channelId).getThreads()).length
  await discord.channel(channelId).user(TEST_USER_ID).sendMessage({ content: 'Fix it waitjob-marker' })
  await waitForFooter({ discord, threadId: channelId, count: footers.length + 1 })
  const thread = (await discord.channel(channelId).getThreads()).find((candidate) => candidate.name === 'Waited task')
  if (!thread) throw new Error('no Waited task thread')
  await waitForFooter({ discord, threadId: thread.id })
  const root = bot.store.getState().roots[channelId]!
  const client = await server.client()
  // No note arrives: not in the inbox, no wake, no "finished" line.
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    const inbox = await client.session.inbox.list({ sessionID: root })
    expect(inbox.filter((item) => item.type === 'synthetic' && item.payload.text.includes('Waited task'))).toHaveLength(0)
  }

  const text = (await discord.channel(channelId).text()).replaceAll(thread.id, 'worker-thread')
  expect(text.slice(text.lastIndexOf('--- from: user'))).toMatchInlineSnapshot(`
    "--- from: user (tommy)
    Fix it waitjob-marker
    --- from: assistant (TestBot)
    -# ┣ shell _Run the worker and wait_

    The waited worker is done.
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
  `)
  expect(await discord.channel(channelId).getThreads()).toHaveLength(threads + 1)
  const messages = await client.message.list({ sessionID: root, order: 'desc', limit: 20 })
  expect(messages.data.some((message) => message.type === 'synthetic' && JSON.stringify(message).includes('Waited task'))).toBe(false)
})

test('another thread of the channel leaves a silent note for the next prompt', async () => {
  const { discord, channelId } = twin
  const footers = (await discord.channel(channelId).getMessages()).filter((message) => message.content.startsWith('-# *project'))
  const started = await send(bot, { channelId, prompt: 'side-marker check something' })
  if (started instanceof Error) throw started
  await waitForFooter({ discord, threadId: started.threadId })
  const client = await server.client()
  const root = bot.store.getState().roots[channelId]!
  await waitFor({
    label: 'silent note in the mainmast',
    check: async () => {
      // Not delivered yet: a note without wake waits in the inbox for the next run.
      const inbox = await client.session.inbox.list({ sessionID: root })
      return inbox.some((item) => item.type === 'synthetic' && item.payload.text.includes('wake="false"')) || null
    },
  })
  // Not woken: no new footer in the channel until the user writes.
  expect((await discord.channel(channelId).getMessages()).filter((message) => message.content.startsWith('-# *project'))).toHaveLength(footers.length)
  await discord.channel(channelId).user(TEST_USER_ID).sendMessage({ content: 'What happened? recap-marker' })
  await waitForFooter({ discord, threadId: channelId, count: footers.length + 1 })

  const text = await discord.channel(channelId).text()
  expect(text.slice(text.lastIndexOf('--- from: user'))).toMatchInlineSnapshot(`
    "--- from: user (tommy)
    What happened? recap-marker
    --- from: assistant (TestBot)
    A side thread finished meanwhile.
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
  `)
})

test('a btw fork of the mainmast is a worker: no coordinator timers', async () => {
  const { discord, channelId } = twin
  const before = (await discord.channel(channelId).getThreads()).length
  await discord.channel(channelId).user(TEST_USER_ID).sendMessage({ content: 'Why that choice btw-marker. btw' })
  const thread = await waitFor({
    label: 'btw thread',
    check: async () => (await discord.channel(channelId).getThreads()).slice(before).find((candidate) => candidate.name?.startsWith('btw:')) ?? null,
  })
  await waitForFooter({ discord, threadId: thread.id })
  const client = await server.client()
  const fork = await client.session.get({ sessionID: bot.store.getState().roots[thread.id]! })
  expect(Reflect.get(Object(fork.metadata?.['kimaki']), 'mainmast')).toBeUndefined()
})

test('the mainmast survives a bot restart; /new-mainmast starts a fresh one', async () => {
  const { discord, channelId } = twin
  const root = bot.store.getState().roots[channelId]
  await bot.stop()
  bot = await startTestBot({ dataDir, twin, server, mainmast: true, mainmastTimers: { nudgeMs: 3_600_000, compactMs: null } })
  expect(bot.store.getState().roots[channelId]).toBe(root)
  // No `warming` in the test config: a nudge after 30 minutes, nothing to compact cheaply.
  expect(await mainmastTimers({ ...bot, mainmastTimers: null }, server.projectDirectory)).toEqual({ nudgeMs: 1_800_000, compactMs: null })

  const { id: interactionId } = await discord.channel(channelId).user(TEST_USER_ID).runSlashCommand({ name: 'new-mainmast' })
  await discord.channel(channelId).waitForInteractionAck({ interactionId, timeout: 4_000 })
  expect(bot.store.getState().roots[channelId]).toBeUndefined()
  const footers = (await discord.channel(channelId).getMessages()).filter((message) => message.content.startsWith('-# *project')).length
  await discord.channel(channelId).user(TEST_USER_ID).sendMessage({ content: 'Fresh start hello-marker' })
  await waitForFooter({ discord, threadId: channelId, count: footers + 1 })

  const fresh = bot.store.getState().roots[channelId]
  expect(fresh && fresh !== root).toBe(true)
  const text = await discord.channel(channelId).text()
  expect(text.slice(text.lastIndexOf('--- from: user'))).toMatchInlineSnapshot(`
    "--- from: user (tommy)
    Fresh start hello-marker
    --- from: assistant (TestBot)
    -# *using deterministic-provider/deterministic-v2 ⋅ build*
    Hello from the mainmast.
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
  `)
})
