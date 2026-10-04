// Session inspection and archival terminal commands.
import { goke } from 'goke'
import { z } from 'zod'
import dedent from 'string-dedent'
import { note } from '@clack/prompts'
import YAML from 'yaml'
import * as errore from 'errore'
import type { OpencodeClient, Event as OpenCodeEvent, Session as OpenCodeSession } from '@opencode-ai/sdk/v2'
import { Events, ActivityType, type PresenceStatusData, type Guild, Routes } from 'discord.js'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn, execSync } from 'node:child_process'
import { createLogger, LogPrefix, initLogFile } from '../logger.js'
import { createDiscordClient, initDatabase, getChannelDirectory, initializeOpencodeForDirectory, createProjectChannels } from '../discord-bot.js'
import { getBotTokenWithMode, getThreadSession, getThreadIdBySessionId, getSessionEventSnapshot, getDb, createScheduledTask, listScheduledTasks, cancelScheduledTask, getScheduledTask, updateScheduledTask, getSessionStartSourcesBySessionIds, deleteChannelDirectoryById, findChannelsByDirectory, getThreadWorktreeOrWorkspace, getAllTextChannelDirectories, getSessionModel, setSessionModel } from '../database.js'
import { ShareMarkdown } from '../markdown.js'
import { parseSessionSearchPattern, collectSessionSearchMatches, validateSessionSearchScope, resolveSessionSearchDirectories, parseSessionSearchDays, sessionSearchMinUpdated, SESSION_SEARCH_DEFAULT_DAYS, type SessionSearchMatch } from '../session-search.js'
import { formatWorktreeName, formatAutoWorktreeName } from '../commands/new-worktree.js'
import { formatTimeAgo } from '../commands/worktrees.js'
import { editorsForFile, loadFileEditEvents } from '../file-edit-log.js'
import { WORKTREE_PREFIX } from '../commands/merge-worktree.js'
import type { ThreadStartMarker } from '../system-message.js'
import { buildOpencodeEventLogLine } from '../session-handler/opencode-session-event-log.js'
import { createDiscordRest } from '../discord-urls.js'
import { archiveThread, buildThreadStartEmbeds, uploadFilesToDiscord, stripMentions } from '../discord-utils.js'
import { OpenCodeSdkError, SessionNotLocatedError } from '../errors.js'
import { writeStdoutAndExit } from '../write-stdout.js'
import { deriveSessionState, hasLiveQuestion, getContextTokens, getLastAssistantText, selectMessages, selectRecoverTarget, toStructuredMessage, visibleMessages, type SessionMessage } from '../session-status.js'
import { validateCliModelOption } from '../session-handler/model-utils.js'
import { QUEUE_PREFIX } from '../message-formatting.js'
import { setDataDir, setProjectsDir, getDataDir, getProjectsDir } from '../config.js'
import { execAsync, validateWorktreeDirectory } from '../worktrees.js'
import { upgrade, getCurrentVersion } from '../upgrade.js'
import { getPromptPreview, parseSendAtValue, parseScheduledTaskPayload, serializeScheduledTaskPayload, type ScheduledTaskPayload } from '../task-schedule.js'
import {
  EXIT_NO_RESTART,
  formatMemberLookupUnavailableMessage,
  formatRelativeTime,
  formatTaskScheduleLine,
  isDiscordMemberLookupUnavailable,
  isGuildMemberSearchResult,
  isThreadChannelType,
  printDiscordInstallUrlAndExit,
  resolveBotCredentials,
  resolveDiscordUserOption,
  sendDiscordMessageWithOptionalAttachment,
} from '../cli-runner.js'

const cliLogger = createLogger(LogPrefix.CLI)
const cli = goke()

async function resolveSessionDirectoryFromDatabase({
  sessionId,
}: {
  sessionId: string
}): Promise<Error | string> {
  const threadId = await getThreadIdBySessionId(sessionId)
  if (threadId) {
    const workspace = await getThreadWorktreeOrWorkspace(threadId)
    if (workspace?.status === 'ready' && workspace.workspace_directory) {
      return workspace.workspace_directory
    }

    const { token: botToken } = await resolveBotCredentials({})
    const rest = createDiscordRest(botToken)
    const threadData = (await rest.get(Routes.channel(threadId))) as {
      id: string
      type: number
      parent_id?: string
    }
    if (!isThreadChannelType(threadData.type)) {
      return new Error(`Channel is not a thread: ${threadId}`)
    }
    if (!threadData.parent_id) {
      return new Error(`Thread has no parent channel: ${threadId}`)
    }
    const channelConfig = await getChannelDirectory(threadData.parent_id)
    if (!channelConfig) {
      return new Error(
        `Thread parent channel is not configured with a project directory: ${threadData.parent_id}`,
      )
    }
    return channelConfig.directory
  }

  return new Error(
    `Session is not linked to a Kimaki thread in the local database: ${sessionId}`,
  )
}

type OpencodeGetClient = Exclude<Awaited<ReturnType<typeof initializeOpencodeForDirectory>>, Error>
type LocatedSession = { getClient: OpencodeGetClient; directory: string; session: OpenCodeSession }

async function findSessionInDirectory({
  sessionId,
  directory,
}: {
  sessionId: string
  directory: string
}): Promise<Error | LocatedSession> {
  const getClient = await initializeOpencodeForDirectory(directory)
  if (getClient instanceof Error) return getClient
  const response = await getClient()
    .session.get({ sessionID: sessionId })
    .catch((cause) => new OpenCodeSdkError({ operation: 'session.get', cause }))
  if (response instanceof Error) return response
  if (!response.data) return new SessionNotLocatedError({ sessionId })
  return { getClient, directory, session: response.data }
}

// session.get is scoped to the client's project, so try cwd (or --project),
// then the directory mapped to the session's Kimaki thread, then every project.
async function locateSession({
  sessionId,
  project,
}: {
  sessionId: string
  project?: string
}): Promise<Error | LocatedSession> {
  const preferred = path.resolve(project || '.')
  const tried = new Set<string>()
  const tryDirectory = async (directory: string) => {
    const resolved = path.resolve(directory)
    if (tried.has(resolved)) return null
    tried.add(resolved)
    const found = await findSessionInDirectory({ sessionId, directory: resolved })
    return found instanceof Error ? null : found
  }

  cliLogger.log('Connecting to OpenCode server...')
  const fromPreferred = await tryDirectory(preferred)
  if (fromPreferred) return fromPreferred

  const databaseDirectory = await resolveSessionDirectoryFromDatabase({ sessionId })
    .catch((cause) => new Error('Failed to resolve session directory from database', { cause }))
  const fromDatabase = typeof databaseDirectory === 'string' ? await tryDirectory(databaseDirectory) : null
  if (fromDatabase) return fromDatabase

  cliLogger.log('Session not in current project, searching all projects...')
  const getClient = await initializeOpencodeForDirectory(preferred)
  if (getClient instanceof Error) return getClient
  const projectsResponse = await getClient()
    .project.list()
    .catch((cause) => new OpenCodeSdkError({ operation: 'project.list', cause }))
  if (projectsResponse instanceof Error) return projectsResponse
  const projects = (projectsResponse.data || [])
    .filter((p) => fs.existsSync(p.worktree))
    .sort((a, b) => b.time.created - a.time.created)
  for (const project of projects) {
    const found = await tryDirectory(project.worktree)
    if (found) return found
  }
  return new SessionNotLocatedError({ sessionId })
}

async function fetchSessionMessages({
  client,
  sessionId,
  limit,
}: {
  client: OpencodeClient
  sessionId: string
  limit?: number
}): Promise<Error | SessionMessage[]> {
  const response = await client.session
    .messages({ sessionID: sessionId, limit })
    .catch((cause) => new OpenCodeSdkError({ operation: 'session.messages', cause }))
  if (response instanceof Error) return response
  if (!response.data) return new OpenCodeSdkError({ operation: 'session.messages', cause: response.error })
  return response.data
}

async function buildSessionStatus({ located, sessionId }: { located: LocatedSession; sessionId: string }) {
  const client = located.getClient()
  const directory = located.session.directory
  const [allMessages, statusResponse, questionsResponse, threadId, sessionModel] = await Promise.all([
    fetchSessionMessages({ client, sessionId }),
    client.session.status({ directory }).catch(() => null),
    client.question.list({ directory }).catch(() => null),
    getThreadIdBySessionId(sessionId),
    getSessionModel(sessionId),
  ])
  if (allMessages instanceof Error) return allMessages
  const messages = visibleMessages({ messages: allMessages, revertMessageId: located.session.revert?.messageID })
  const liveStatus = statusResponse?.data?.[sessionId]
  const busy = Boolean(liveStatus && liveStatus.type !== 'idle')
  const pendingQuestion = hasLiveQuestion({ sessionId, questions: questionsResponse?.data || [], messages })
  const { state, lastError } = deriveSessionState({ messages, busy, pendingQuestion })
  const lastMessage = messages.at(-1)
  const last = lastMessage ? toStructuredMessage({ message: lastMessage, toolInputMaxChars: 80 }) : null
  return {
    sessionId,
    title: located.session.title || 'Untitled Session',
    directory,
    threadId: threadId || null,
    state,
    lastError,
    retry: liveStatus?.type === 'retry' ? { attempt: liveStatus.attempt, message: liveStatus.message } : null,
    pendingQuestion,
    agent: last?.agent || null,
    model: last?.model || null,
    sessionModel: sessionModel || null,
    contextTokens: getContextTokens(messages),
    lastAssistantText: getLastAssistantText({ messages, maxChars: 500 }),
    lastMessageId: last?.id || null,
    updated: new Date(located.session.time.updated).toISOString(),
    messages,
  }
}

// Total token footprint of a session (input + output + reasoning + cache).
function getSessionTokenTotal(tokens: {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}): number {
  return (
    tokens.input +
    tokens.output +
    tokens.reasoning +
    tokens.cache.read +
    tokens.cache.write
  )
}

// Compact token count: 1234 -> "1k", 200000 -> "200k", 1_500_000 -> "1.5M".
function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`
  }
  if (count >= 1_000) {
    return `${Math.round(count / 1_000)}k`
  }
  return String(count)
}

cli
  .command(
    'session list',
    'List all OpenCode sessions, marking which were started via Kimaki',
  )
  .option(
    '--project <path>',
    'Project directory to list sessions for (defaults to cwd)',
  )
  .option('--all', 'List sessions across every locally registered project')
  .option('--active', 'Only list active sessions; exits 1 when none remain')
  .option('--exclude <sessionId>', 'Exclude one session ID from the results')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      await initDatabase()

      if (options.all && options.project) {
        cliLogger.error('Use either --all or --project, not both')
        process.exit(EXIT_NO_RESTART)
      }

      const projectDirectories = options.all
        ? Array.from(
            new Set(
              (await getAllTextChannelDirectories()).map((directory) =>
                path.resolve(directory),
              ),
            ),
          )
        : [path.resolve(options.project || '.')]

      if (projectDirectories.length === 0) {
        cliLogger.error(
          'No registered project directories found. Add a project with `kimaki project add`.',
        )
        process.exit(EXIT_NO_RESTART)
      }

      // Connect to each project's OpenCode server and gather sessions plus
      // their live idle/busy status. Only session.list + session.status are
      // called per project so the command stays fast; per-session token totals
      // come straight from the session objects with no message fetching.
      // A session parked on a `question` tool reports session.status busy but
      // is really waiting for the user, so it is not "active". Treat it as
      // `showing-question` (excluded by --active) using OpenCode's
      // server-authoritative pending-question list.
      type GatheredSession = {
        session: OpenCodeSession
        projectDirectory: string
        client: OpencodeClient
        status: 'idle' | 'busy' | 'showing-question'
      }

      const gathered: GatheredSession[] = []
      for (const projectDirectory of projectDirectories) {
        cliLogger.log(`Connecting to OpenCode server for ${projectDirectory}...`)
        const getClient = await initializeOpencodeForDirectory(projectDirectory)
        if (getClient instanceof Error) {
          if (options.all) {
            cliLogger.warn(
              `Skipping ${projectDirectory}: failed to connect to OpenCode: ${getClient.message}`,
            )
            continue
          }
          cliLogger.error('Failed to connect to OpenCode:', getClient.message)
          process.exit(EXIT_NO_RESTART)
        }

        const client = getClient()
        const [sessionsResponse, statusResponse, questionsResponse] = await Promise.all([
          client.session.list(),
          client.session.status({ directory: projectDirectory }).catch(() => null),
          client.question.list({ directory: projectDirectory }).catch(() => null),
        ])

        const statuses = statusResponse?.data || {}
        const sessionsWithPendingQuestion = new Set(
          (questionsResponse?.data || []).map((request) => request.sessionID),
        )

        for (const session of sessionsResponse.data || []) {
          const status = statuses[session.id]
          const isBusy = Boolean(status && status.type !== 'idle')
          // Only relabel to showing-question when the session is actually busy.
          // An orphaned question left in the list after an abort (session idle)
          // must not hide or relabel an otherwise-idle session.
          gathered.push({
            session,
            projectDirectory,
            client,
            status: isBusy && sessionsWithPendingQuestion.has(session.id)
              ? 'showing-question'
              : isBusy
                ? 'busy'
                : 'idle',
          })
        }
      }

      const selected = gathered
        .filter((entry) => {
          if (entry.session.id === options.exclude) return false
          if (options.active && entry.status !== 'busy') return false
          return true
        })
        .sort((a, b) => b.session.time.updated - a.session.time.updated)

      if (selected.length === 0) {
        if (options.json) console.log('[]')
        else
          cliLogger.log(
            options.active ? 'No active sessions found' : 'No sessions found',
          )
        process.exit(options.active ? 1 : 0)
      }

      // Look up which sessions were started via kimaki (have a thread mapping)
      const db = await getDb()
      const threadSessions = await db.query.thread_sessions.findMany({
        columns: { thread_id: true, session_id: true },
      })
      const sessionToThread = new Map(
        threadSessions
          .filter((row) => row.session_id !== '')
          .map((row) => [row.session_id, row.thread_id]),
      )
      const sessionStartSources = await getSessionStartSourcesBySessionIds(
        selected.map((entry) => entry.session.id),
      )

      const scheduleModeLabel = ({
        scheduleKind,
      }: {
        scheduleKind: 'at' | 'cron'
      }): 'delay' | 'cron' => {
        if (scheduleKind === 'at') {
          return 'delay'
        }
        return 'cron'
      }

      // Token footprint straight from the session object (no message fetch).
      // Session.tokens is a per-session aggregate, so it is reported as a token
      // count rather than a context-window percentage.
      const contextInfo = (entry: GatheredSession): number | null => {
        const tokens = entry.session.tokens
        if (!tokens) return null
        const total = getSessionTokenTotal(tokens)
        return total > 0 ? total : null
      }

      if (options.json) {
        // Only the newest message decides blocked/errored, so fetch one per idle session.
        const health = await Promise.all(selected.map(async (entry) => {
          if (entry.status !== 'idle') return { state: entry.status === 'busy' ? 'working' : 'question', lastError: null }
          const messages = await fetchSessionMessages({ client: entry.client, sessionId: entry.session.id, limit: 1 })
          if (messages instanceof Error) return { state: null, lastError: null }
          return deriveSessionState({ messages, busy: false, pendingQuestion: false })
        }))
        const output = selected.map((entry, index) => {
          const session = entry.session
          const startSource = sessionStartSources.get(session.id)
          const startedBy = startSource
            ? `scheduled-${scheduleModeLabel({ scheduleKind: startSource.schedule_kind })}`
            : null
          return {
            id: session.id,
            title: session.title || 'Untitled Session',
            directory: session.directory,
            updated: new Date(session.time.updated).toISOString(),
            source: sessionToThread.has(session.id) ? 'kimaki' : 'opencode',
            threadId: sessionToThread.get(session.id) || null,
            status: entry.status,
            state: health[index]?.state ?? null,
            lastError: health[index]?.lastError ?? null,
            model: session.model?.id || null,
            tokens: contextInfo(entry),
            startedBy,
            scheduledTaskId: startSource?.scheduled_task_id || null,
          }
        })
        return writeStdoutAndExit(`${JSON.stringify(output, null, 2)}\n`)
      }

      for (const entry of selected) {
        const session = entry.session
        const threadId = sessionToThread.get(session.id)
        const startSource = sessionStartSources.get(session.id)
        const source = threadId ? '(kimaki)' : '(opencode)'
        const startedBy = startSource
          ? ` | started-by: ${scheduleModeLabel({ scheduleKind: startSource.schedule_kind })}${startSource.scheduled_task_id ? ` (#${startSource.scheduled_task_id})` : ''}`
          : ''
        const updatedAt = new Date(session.time.updated).toISOString()
        const threadInfo = threadId ? ` | thread: ${threadId}` : ''
        const statusLabel = entry.status === 'busy'
          ? 'working'
          : entry.status === 'showing-question'
            ? 'showing-question'
            : 'idle'
        const statusInfo = ` | status: ${statusLabel}`
        const tokens = contextInfo(entry)
        const tokensText = tokens ? ` | tokens: ${formatTokenCount(tokens)}` : ''
        console.log(
          `${session.id} | ${session.title || 'Untitled Session'} | ${session.directory} | ${updatedAt} | ${source}${statusInfo}${tokensText}${threadInfo}${startedBy}`,
        )
      }

      process.exit(0)
    } catch (error) {
      cliLogger.error(
        'Error:',
        error instanceof Error ? error.stack : String(error),
      )
      process.exit(EXIT_NO_RESTART)
    }
  })

cli
  .command(
    'session editors <file>',
    dedent`
      List sessions that last edited a file, newest first.

      Use this before a commit in another session so the \`Session:\` line
      uses the session that actually edited the file.
    `,
  )
  .option('--json', 'Output as JSON')
  .option(
    '--limit <n>',
    z.number().default(20).describe('Max sessions to show'),
  )
  .example('kimaki session editors src/cli.ts')
  .example('kimaki session editors src/cli.ts --json')
  .action(async (file, options, { console, process }) => {
    try {
      const cwd = process.cwd
      const loaded = loadFileEditEvents({ dataDir: getDataDir() })
      if (loaded instanceof Error) {
        console.error(loaded.message)
        process.exit(EXIT_NO_RESTART)
        return
      }

      const editors = editorsForFile({
        events: loaded,
        filePath: file,
        cwd,
      }).slice(0, options.limit)
      if (editors.length === 0) {
        console.error(`No recorded editors for ${path.resolve(cwd, file)}`)
        process.exit(1)
        return
      }

      const titles = new Map<string, string>()
      try {
        await initDatabase()
        const db = await getDb()
        const sessionRows = await db.query.thread_sessions.findMany({
          columns: { session_id: true, last_synced_name: true },
          where: { session_id: { in: editors.map((editor) => editor.sessionId) } },
          orderBy: { updated_at: 'desc' },
        })
        for (const row of sessionRows) {
          if (!titles.has(row.session_id) && row.last_synced_name) {
            titles.set(row.session_id, row.last_synced_name)
          }
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
      }

      const rows = editors.map((editor) => {
        const title = titles.get(editor.sessionId) || '-'
        const editedAt = new Date(editor.at)
        return {
          sessionId: editor.sessionId,
          title,
          editedAt: editedAt.toISOString(),
          ago: formatTimeAgo(editedAt),
        }
      })

      if (options.json) {
        console.log(JSON.stringify(rows, null, 2))
        process.exit(0)
        return
      }

      for (const row of rows) {
        console.log(`${row.sessionId} | ${row.title} | ${row.ago}`)
      }
      process.exit(0)
    } catch (error) {
      console.error(error instanceof Error ? error.stack : String(error))
      process.exit(EXIT_NO_RESTART)
    }
  })

cli
  .command(
    'session read <sessionId>',
    dedent`
      Read a session conversation as markdown (pipe to file to grep).

      Thinking is omitted by default. Tool inputs are truncated. Use
      \`--thinking\` and \`--verbose\` for the full dump. Use \`--json\` for
      structured messages with ids, model, tool summaries and message errors.
    `,
  )
  .option('--project <path>', 'Project directory (defaults to cwd)')
  .option('--verbose', 'Show full tool inputs and outputs instead of compact summaries')
  .option('--thinking', 'Include reasoning / thinking parts')
  .option(
    '--tool-input-max-chars <n>',
    z.number().default(80).describe('Max characters for compact tool input'),
  )
  .option('--json', 'Output structured messages as JSON')
  .option('--last <n>', z.number().optional().describe('With --json, only the last n messages'))
  .option('--since <messageId>', 'With --json, only messages after this message id')
  .example('kimaki session read ses_xxx > ./tmp/session.md')
  .example('kimaki session read ses_xxx --thinking --verbose')
  .example('kimaki session read ses_xxx --json --last 5')
  .action(async (sessionId, options) => {
    try {
      await initDatabase()

      const located = await locateSession({ sessionId, project: options.project })
      if (located instanceof Error) {
        cliLogger.error(located.message)
        process.exit(EXIT_NO_RESTART)
      }
      const client = located.getClient()

      if (!options.json) {
        const result = await new ShareMarkdown(client).generate({
          sessionID: sessionId,
          compactTools: !options.verbose,
          includeThinking: options.thinking,
          toolInputMaxChars: options.toolInputMaxChars,
        })
        if (result instanceof Error) {
          cliLogger.error(result.message)
          process.exit(EXIT_NO_RESTART)
        }
        return writeStdoutAndExit(result)
      }

      const messages = await fetchSessionMessages({ client, sessionId })
      if (messages instanceof Error) {
        cliLogger.error(messages.message)
        process.exit(EXIT_NO_RESTART)
      }
      const selected = selectMessages({ messages, last: options.last, since: options.since })
      if (selected instanceof Error) {
        cliLogger.error(selected.message)
        process.exit(EXIT_NO_RESTART)
      }
      const output = {
        sessionId,
        title: located.session.title || 'Untitled Session',
        directory: located.session.directory,
        messages: selected.map((message) => {
          return toStructuredMessage({ message, toolInputMaxChars: options.toolInputMaxChars })
        }),
      }
      return writeStdoutAndExit(`${JSON.stringify(output, null, 2)}\n`)
    } catch (error) {
      cliLogger.error(
        'Error:',
        error instanceof Error ? error.stack : String(error),
      )
      process.exit(EXIT_NO_RESTART)
    }
  })

cli
  .command(
    'session status <sessionId>',
    dedent`
      Show whether a session is idle, working, blocked, errored or waiting on a question.

      blocked: the last assistant message was refused by a provider content or
      safety filter, so retrying the same context will not help.
      errored: the last assistant message ended with any other error.
      Use \`kimaki session recover\` to revert the failed turn and resend it.
    `,
  )
  .option('--project <path>', 'Project directory (defaults to cwd)')
  .option('--json', 'Output as JSON')
  .example('kimaki session status ses_xxx --json')
  .action(async (sessionId, options) => {
    try {
      await initDatabase()
      const located = await locateSession({ sessionId, project: options.project })
      if (located instanceof Error) {
        cliLogger.error(located.message)
        process.exit(EXIT_NO_RESTART)
      }
      const status = await buildSessionStatus({ located, sessionId })
      if (status instanceof Error) {
        cliLogger.error(status.message)
        process.exit(EXIT_NO_RESTART)
      }
      const { messages: _messages, ...output } = status
      if (options.json) return writeStdoutAndExit(`${JSON.stringify(output, null, 2)}\n`)

      const lines = [
        `session: ${output.sessionId} | ${output.title}`,
        `state: ${output.state}${output.retry ? ` (retry ${output.retry.attempt}: ${output.retry.message})` : ''}`,
        output.lastError ? `last error: ${output.lastError.name}${output.lastError.message ? `: ${output.lastError.message}` : ''}` : '',
        `agent: ${output.agent || '-'} | model: ${output.model || '-'}`,
        output.sessionModel
          ? `session model: ${output.sessionModel.modelId}${output.sessionModel.variant ? ` (${output.sessionModel.variant})` : ''}${output.sessionModel.locked ? ' [locked]' : ''}`
          : '',
        output.contextTokens ? `context tokens: ${formatTokenCount(output.contextTokens)}` : '',
        output.threadId ? `thread: ${output.threadId}` : '',
        output.pendingQuestion ? 'pending question: yes' : '',
        `updated: ${output.updated}`,
        output.lastAssistantText ? `last reply: ${output.lastAssistantText}` : '',
      ]
      return writeStdoutAndExit(`${lines.filter(Boolean).join('\n')}\n`)
    } catch (error) {
      cliLogger.error('Error:', error instanceof Error ? error.stack : String(error))
      process.exit(EXIT_NO_RESTART)
    }
  })

cli
  .command(
    'session model <sessionId>',
    dedent`
      Show or set the model pinned to a session.

      A locked model is kept when prompts switch agents, and a per-prompt
      \`kimaki send --model\` is ignored with a warning. Use \`--unlock\` to allow
      changes again.
    `,
  )
  .option('--set <model>', 'Pin this model (format: provider/model)')
  .option('--variant <variant>', 'Thinking variant to store with the model')
  .option('--lock', 'Lock the session model')
  .option('--unlock', 'Unlock the session model')
  .option('--project <path>', 'Project directory used to validate the model (defaults to cwd)')
  .option('--json', 'Output as JSON')
  .example('kimaki session model ses_xxx')
  .example('kimaki session model ses_xxx --set anthropic/claude-opus-4-6 --lock')
  .example('kimaki session model ses_xxx --unlock')
  .action(async (sessionId, options) => {
    try {
      await initDatabase()
      if (options.lock && options.unlock) {
        cliLogger.error('Use either --lock or --unlock, not both')
        process.exit(EXIT_NO_RESTART)
      }

      const current = await getSessionModel(sessionId)
      const isUpdate = Boolean(options.set || options.variant || options.lock || options.unlock)
      const modelId = await (async () => {
        if (!isUpdate) return current?.modelId
        if (options.set) return options.set
        if (options.unlock && !options.variant && !current) return undefined
        if (current) return current.modelId
        if (!options.lock) {
          return new Error('Session has no pinned model. Pass --set provider/model')
        }
        const located = await locateSession({ sessionId, project: options.project })
        if (located instanceof Error) return located
        const messages = await fetchSessionMessages({ client: located.getClient(), sessionId })
        if (messages instanceof Error) return messages
        const lastUser = messages.findLast((message) => message.info.role === 'user')
        if (lastUser?.info.role !== 'user') {
          return new Error('Session has no pinned or used model yet. Pass --set provider/model')
        }
        return `${lastUser.info.model.providerID}/${lastUser.info.model.modelID}`
      })()
      if (modelId instanceof Error) {
        cliLogger.error(modelId.message)
        process.exit(EXIT_NO_RESTART)
      }

      if (isUpdate && modelId) {
        if (options.set) {
          const located = await locateSession({ sessionId, project: options.project })
          if (located instanceof Error) {
            cliLogger.warn(`Could not reach the session's OpenCode project, only checking the model format: ${located.message}`)
          }
          const validated = await validateCliModelOption({
            model: options.set,
            directory: located instanceof Error ? undefined : located.directory,
          })
          if (validated instanceof Error) {
            cliLogger.error(validated.message)
            process.exit(EXIT_NO_RESTART)
          }
        }
        const keepVariant = !options.set || options.set === current?.modelId
        await setSessionModel({
          sessionId,
          modelId,
          variant: options.variant || (keepVariant ? current?.variant : null) || null,
          locked: options.lock ? true : options.unlock ? false : undefined,
        })
      }

      const result = await getSessionModel(sessionId)
      const output = {
        sessionId,
        model: result?.modelId || null,
        variant: result?.variant || null,
        locked: Boolean(result?.locked),
      }
      if (options.json) return writeStdoutAndExit(`${JSON.stringify(output, null, 2)}\n`)
      const text = output.model
        ? `${output.model}${output.variant ? ` (variant: ${output.variant})` : ''}${output.locked ? ' [locked]' : ''}`
        : 'No session model pinned (falls back to agent, channel, then global model)'
      return writeStdoutAndExit(`${text}\n`)
    } catch (error) {
      cliLogger.error('Error:', error instanceof Error ? error.stack : String(error))
      process.exit(EXIT_NO_RESTART)
    }
  })

cli
  .command(
    'session recover <sessionId>',
    dedent`
      Recover a session whose last assistant turn errored or was blocked.

      Reverts the failed assistant messages (never past a successful step) and
      resends through the Discord thread on the same agent and model. If the
      whole turn failed, the original user prompt is replayed; if earlier steps
      of the turn succeeded, only the failed steps are reverted and the agent is
      asked to continue. Does nothing when the session is idle and healthy.
    `,
  )
  .option('--prompt <prompt>', 'Prompt to send instead of the replayed or continue prompt')
  .option('--project <path>', 'Project directory (defaults to cwd)')
  .option('--dry-run', 'Print what would be reverted and sent without changing anything')
  .example('kimaki session recover ses_xxx --dry-run')
  .example('kimaki session recover ses_xxx --prompt "Continue, avoid quoting the payload"')
  .action(async (sessionId, options) => {
    try {
      await initDatabase()
      const located = await locateSession({ sessionId, project: options.project })
      if (located instanceof Error) {
        cliLogger.error(located.message)
        process.exit(EXIT_NO_RESTART)
      }
      const status = await buildSessionStatus({ located, sessionId })
      if (status instanceof Error) {
        cliLogger.error(status.message)
        process.exit(EXIT_NO_RESTART)
      }
      if (status.state === 'working' || status.state === 'question') {
        return writeStdoutAndExit(
          `Session is ${status.state}, nothing to recover. Abort it first with \`kimaki session abort ${sessionId}\`.\n`,
        )
      }

      const plan = selectRecoverTarget({
        messages: status.messages,
        revertMessageId: located.session.revert?.messageID,
        prompt: options.prompt,
      })
      if (plan.kind === 'healthy') return writeStdoutAndExit(`Session is healthy: ${plan.reason}. Nothing to do.\n`)
      if (plan.kind === 'unrecoverable') {
        cliLogger.error(`Cannot recover: ${plan.reason}`)
        process.exit(EXIT_NO_RESTART)
      }
      if (!status.threadId) {
        cliLogger.error(`Session ${sessionId} is not linked to a Kimaki thread, so the resend cannot go through Discord`)
        process.exit(EXIT_NO_RESTART)
      }

      // A pinned session model is used by the bot anyway; pass the failed
      // model only when nothing is pinned so the retry runs on the same model.
      const markerModel = status.sessionModel ? undefined : plan.model
      const summary = [
        `${options.dryRun ? 'Would recover' : 'Recovering'} session ${sessionId} (${status.state}: ${plan.error.name}${plan.error.message ? `: ${plan.error.message}` : ''})`,
        `revert from message: ${plan.revertMessageId} (${plan.failedMessageIds.length} failed assistant message(s)${plan.replay ? ' + user prompt' : ''})`,
        `send to thread ${status.threadId}: agent ${plan.agent}, model ${status.sessionModel?.modelId || plan.model}`,
        `prompt: ${plan.prompt.length > 300 ? `${plan.prompt.slice(0, 299)}…` : plan.prompt}`,
      ].join('\n')
      if (options.dryRun) return writeStdoutAndExit(`${summary}\n`)
      cliLogger.log(summary)

      const revertResponse = await located.getClient()
        .session.revert({
          sessionID: sessionId,
          directory: located.session.directory,
          messageID: plan.revertMessageId,
        })
        .catch((cause) => new OpenCodeSdkError({ operation: 'session.revert', cause }))
      if (revertResponse instanceof Error || revertResponse.error) {
        cliLogger.error(
          `Failed to revert session: ${revertResponse instanceof Error ? revertResponse.message : JSON.stringify(revertResponse.error)}`,
        )
        process.exit(EXIT_NO_RESTART)
      }

      const { token: botToken } = await resolveBotCredentials()
      const rest = createDiscordRest(botToken)
      const marker: ThreadStartMarker = {
        start: true,
        agent: plan.agent,
        ...(markerModel && { model: markerModel }),
      }
      await sendDiscordMessageWithOptionalAttachment({
        channelId: status.threadId,
        prompt: `${QUEUE_PREFIX}**kimaki-cli:**\n${plan.prompt}`,
        botToken,
        embeds: await buildThreadStartEmbeds(marker),
        rest,
      })
      note(`Reverted ${plan.revertMessageId} and resent to thread ${status.threadId}`, 'Recovered')
      return writeStdoutAndExit(`Session: ${sessionId}\n`)
    } catch (error) {
      cliLogger.error('Error:', error instanceof Error ? error.stack : String(error))
      process.exit(EXIT_NO_RESTART)
    }
  })

cli
  .command(
    'session wait <sessionId>',
    'Wait until a session finishes or pauses for a user question, then print its conversation as markdown',
  )
  .action(async (sessionId) => {
    try {
      await initDatabase()

      const projectDirectory = await resolveSessionDirectoryFromDatabase({
        sessionId,
      })
      if (projectDirectory instanceof Error) {
        cliLogger.error(projectDirectory.message)
        process.exit(EXIT_NO_RESTART)
      }

      const { waitAndOutputExistingSession } = await import('../wait-session.js')
      await waitAndOutputExistingSession({
        sessionId,
        projectDirectory,
      })

      process.exit(0)
    } catch (error) {
      cliLogger.error(
        'Error:',
        error instanceof Error ? error.stack : String(error),
      )
      process.exit(EXIT_NO_RESTART)
    }
  })

cli
  .command(
    'session search <query>',
    `Search past sessions for text or /regex/flags. Defaults to the last ${SESSION_SEARCH_DEFAULT_DAYS} days; use --days 0 for all time. Add --all for every locally registered project.`,
  )
  .option('--project <path>', 'Project directory (defaults to cwd)')
  .option('--channel <channelId>', 'Resolve project from a Discord channel ID')
  .option('--all', 'Search every locally registered project')
  .option(
    '--days <n>',
    `Only search sessions updated in the last n days (default: ${SESSION_SEARCH_DEFAULT_DAYS}; 0 = all time)`,
  )
  .option('--limit <n>', 'Maximum matched sessions to return (default: 20)')
  .option('--json', 'Output as JSON')
  .example('kimaki session search "auth timeout"')
  .example('kimaki session search "auth timeout" --days 0')
  .example('kimaki session search "auth timeout" --all')
  .action(async (query, options) => {
    try {
      await initDatabase()

      const scopeError = validateSessionSearchScope({
        all: options.all,
        project: options.project,
        channel: options.channel,
      })
      if (scopeError) {
        cliLogger.error(scopeError.message)
        process.exit(EXIT_NO_RESTART)
      }

      const limit = (() => {
        const rawLimit =
          typeof options.limit === 'string' ? options.limit : '20'
        const parsed = Number.parseInt(rawLimit, 10)
        if (Number.isNaN(parsed) || parsed < 1) {
          return new Error(`Invalid --limit value: ${rawLimit}`)
        }
        return parsed
      })()

      if (limit instanceof Error) {
        cliLogger.error(limit.message)
        process.exit(EXIT_NO_RESTART)
      }

      const days = parseSessionSearchDays(
        typeof options.days === 'string' ? options.days : undefined,
      )
      if (days instanceof Error) {
        cliLogger.error(days.message)
        process.exit(EXIT_NO_RESTART)
      }
      const minUpdated = sessionSearchMinUpdated({ days })

      const explicitDirectory = await (async (): Promise<string | Error | undefined> => {
        if (options.all) {
          return undefined
        }
        if (options.channel) {
          const channelConfig = await getChannelDirectory(options.channel)
          if (!channelConfig) {
            return new Error(
              `No project mapping found for channel: ${options.channel}`,
            )
          }
          return path.resolve(channelConfig.directory)
        }
        if (options.project) {
          return path.resolve(options.project)
        }
        return undefined
      })()

      if (explicitDirectory instanceof Error) {
        cliLogger.error(explicitDirectory.message)
        process.exit(EXIT_NO_RESTART)
      }

      const registeredDirectories = options.all
        ? (await getAllTextChannelDirectories()).map((directory) => {
            return path.resolve(directory)
          })
        : []
      const projectDirectories = resolveSessionSearchDirectories({
        all: Boolean(options.all),
        registeredDirectories,
        cwd: path.resolve('.'),
        explicitDirectory,
      })
      if (projectDirectories instanceof Error) {
        cliLogger.error(projectDirectories.message)
        process.exit(EXIT_NO_RESTART)
      }

      const existingDirectories: string[] = []
      for (const directory of projectDirectories) {
        if (fs.existsSync(directory)) {
          existingDirectories.push(directory)
          continue
        }
        if (options.all) {
          cliLogger.warn(`Skipping missing directory: ${directory}`)
          continue
        }
        cliLogger.error(`Directory does not exist: ${directory}`)
        process.exit(EXIT_NO_RESTART)
      }
      if (existingDirectories.length === 0) {
        cliLogger.error(
          'No searchable project directories found. Add a project with `kimaki project add`, or pass --project.',
        )
        process.exit(EXIT_NO_RESTART)
      }

      const searchPattern = parseSessionSearchPattern(query)
      if (searchPattern instanceof Error) {
        cliLogger.error(searchPattern.message)
        process.exit(EXIT_NO_RESTART)
      }

      type OpencodeGetClient = Exclude<
        Awaited<ReturnType<typeof initializeOpencodeForDirectory>>,
        Error
      >
      const clientsBySessionId = new Map<string, OpencodeGetClient>()
      const searchedDirectories: string[] = []
      const searchableSessions: Array<{
        id: string
        title: string
        directory: string
        updated: number
      }> = []

      const listedDirectories = await Promise.all(
        existingDirectories.map(async (projectDirectory) => {
          cliLogger.log(`Connecting to OpenCode server for ${projectDirectory}...`)
          const getClient = await initializeOpencodeForDirectory(projectDirectory)
          if (getClient instanceof Error) {
            return { projectDirectory, getClient, sessions: [] }
          }
          const sessionsResponse = await getClient().session.list()
          return {
            projectDirectory,
            getClient,
            sessions: sessionsResponse.data || [],
          }
        }),
      )
      for (const listed of listedDirectories) {
        if (listed.getClient instanceof Error) {
          if (options.all) {
            cliLogger.warn(
              `Skipping ${listed.projectDirectory}: failed to connect to OpenCode: ${listed.getClient.message}`,
            )
            continue
          }
          cliLogger.error(
            'Failed to connect to OpenCode:',
            listed.getClient.message,
          )
          process.exit(EXIT_NO_RESTART)
        }
        searchedDirectories.push(listed.projectDirectory)
        for (const session of listed.sessions) {
          clientsBySessionId.set(session.id, listed.getClient)
          searchableSessions.push({
            id: session.id,
            title: session.title || 'Untitled Session',
            directory: session.directory || listed.projectDirectory,
            updated: session.time.updated,
          })
        }
      }

      if (searchableSessions.length === 0) {
        cliLogger.log('No sessions found')
        process.exit(0)
      }

      const db = await getDb()
      const threadSessions = await db.query.thread_sessions.findMany({
        columns: { thread_id: true, session_id: true },
      })
      const sessionToThread = new Map(
        threadSessions
          .filter((row) => row.session_id !== '')
          .map((row) => [row.session_id, row.thread_id]),
      )

      const scopeLabel = options.all
        ? `${searchedDirectories.length} project(s)`
        : searchedDirectories[0] || path.resolve('.')
      const daysLabel =
        days === 0 ? 'all time' : `the last ${days} day${days === 1 ? '' : 's'}`
      const printMatch = (match: SessionSearchMatch) => {
        const threadInfo = match.threadId ? ` | thread: ${match.threadId}` : ''
        console.log(
          `${match.id} | ${match.title} | ${match.updated} | ${match.source}${threadInfo}`,
        )
        console.log(`  Directory: ${match.directory}`)
        match.snippets.forEach((snippet) => {
          console.log(`  - ${snippet}`)
        })
      }

      let printedHeader = false
      const { matches: matchedSessions, scannedSessions } =
        await collectSessionSearchMatches({
          sessions: searchableSessions,
          searchPattern,
          sessionToThread,
          limit,
          minUpdated,
          onMatch: options.json
            ? undefined
            : (match) => {
                if (!printedHeader) {
                  printedHeader = true
                  cliLogger.log(
                    `Found matching session(s) for ${searchPattern.raw} in ${scopeLabel} (${daysLabel})`,
                  )
                }
                printMatch(match)
              },
          loadMessages: async (session) => {
            const getClient = clientsBySessionId.get(session.id)
            if (!getClient) {
              return []
            }
            const messagesResponse = await getClient().session.messages({
              sessionID: session.id,
            })
            return messagesResponse.data || []
          },
        })

      if (options.json) {
        const output = {
          query: searchPattern.raw,
          mode: searchPattern.mode,
          all: Boolean(options.all),
          days,
          projectDirectories: searchedDirectories,
          scannedSessions,
          matches: matchedSessions,
        }
        return writeStdoutAndExit(`${JSON.stringify(output, null, 2)}\n`)
      }

      if (matchedSessions.length === 0) {
        const cutoffHint =
          days === 0 ? '' : '. Use --days 0 to search all time'
        cliLogger.log(
          `No matches found for ${searchPattern.raw} in ${scopeLabel} (${scannedSessions} sessions scanned, ${daysLabel})${cutoffHint}`,
        )
        process.exit(0)
      }

      process.exit(0)
    } catch (error) {
      cliLogger.error(
        'Error:',
        error instanceof Error ? error.stack : String(error),
      )
      process.exit(EXIT_NO_RESTART)
    }
  })

cli
  .command(
    'session export-events-jsonl',
    'Export persisted session events from SQLite to JSONL for debugging Kimaki runtime bugs',
  )
  .option(
    '--session <sessionId>',
    'Session ID whose persisted event stream should be exported',
  )
  .option(
    '--out <file>',
    'Output .jsonl path (useful for reproducing Kimaki issues in event-stream-state tests)',
  )
  .action(async (options) => {
    const sessionId =
      typeof options.session === 'string' ? options.session.trim() : ''
    if (!sessionId) {
      cliLogger.error('Missing --session value')
      process.exit(EXIT_NO_RESTART)
    }

    const outFile = typeof options.out === 'string' ? options.out.trim() : ''
    if (!outFile) {
      cliLogger.error('Missing --out value')
      process.exit(EXIT_NO_RESTART)
    }
    if (path.extname(outFile).toLowerCase() !== '.jsonl') {
      cliLogger.error('--out must point to a .jsonl file')
      process.exit(EXIT_NO_RESTART)
    }

    const outPath = path.resolve(outFile)
    const rows = await getSessionEventSnapshot({ sessionId })
    if (rows.length === 0) {
      cliLogger.error(
        `No persisted events found for session ${sessionId}. The session may not have emitted events yet.`,
      )
      process.exit(EXIT_NO_RESTART)
    }

    const parsedRows = rows.flatMap((row) => {
      const parsed = errore.try(
        () => {
          return JSON.parse(row.event_json) as OpenCodeEvent
        },
        (error) => {
          return new Error('Failed to parse persisted event JSON', {
            cause: error,
          })
        },
      )
      if (parsed instanceof Error) {
        cliLogger.warn(
          `Skipping invalid persisted event row ${row.id}: ${parsed.message}`,
        )
        return []
      }

      return [{ row, event: parsed }]
    })

    if (parsedRows.length === 0) {
      cliLogger.error(
        `No valid persisted events found for session ${sessionId}.`,
      )
      process.exit(EXIT_NO_RESTART)
    }

    const projectDirectory = parsedRows.reduce((directory, { event }) => {
      if (directory) {
        return directory
      }
      if (event.type !== 'session.updated') {
        return directory
      }
      return event.properties.info.directory
    }, '')

    const lines = parsedRows.map(({ row, event }) => {
      return JSON.stringify(
        buildOpencodeEventLogLine({
          timestamp: Number(row.timestamp),
          threadId: row.thread_id,
          projectDirectory,
          event,
        }),
      )
    })
    const jsonl = `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, jsonl, 'utf8')
    cliLogger.log(
      `Exported ${lines.length} events from ${sessionId} to ${outPath}`,
    )
    process.exit(0)
  })

cli
  .command(
    'session archive [threadId]',
    'Archive a Discord thread without stopping its mapped OpenCode session',
  )
  .option('--session <sessionId>', 'Resolve thread from an OpenCode session ID')
  .action(async (threadIdArg: string | undefined, options: { session?: string }) => {
    try {
      await initDatabase()

      // Resolve threadId from --session or positional arg
      if (threadIdArg && options.session) {
        cliLogger.error('Use either a thread ID or --session, not both')
        process.exit(EXIT_NO_RESTART)
      }
      const resolvedThreadId = await (async (): Promise<string> => {
        if (threadIdArg) {
          return threadIdArg
        }
        if (options.session) {
          const id = await getThreadIdBySessionId(options.session)
          if (!id) {
            cliLogger.error(`No Discord thread found for session: ${options.session}`)
            process.exit(EXIT_NO_RESTART)
          }
          return id
        }
        cliLogger.error('Provide a thread ID or --session <sessionId>')
        process.exit(EXIT_NO_RESTART)
      })()

      const { token: botToken } = await resolveBotCredentials()

      const rest = createDiscordRest(botToken)
      const threadData = (await rest.get(Routes.channel(resolvedThreadId))) as {
        id: string
        type: number
        name?: string
        parent_id?: string
      }

      if (!isThreadChannelType(threadData.type)) {
        cliLogger.error(`Channel is not a thread: ${resolvedThreadId}`)
        process.exit(EXIT_NO_RESTART)
      }

      const sessionId = options.session || await getThreadSession(resolvedThreadId)
      let client: OpencodeClient | null = null
      if (sessionId && threadData.parent_id) {
        const channelConfig = await getChannelDirectory(threadData.parent_id)
        if (!channelConfig) {
          cliLogger.warn(
            `No channel directory mapping found for parent channel ${threadData.parent_id}`,
          )
        } else {
          const getClient = await initializeOpencodeForDirectory(
            channelConfig.directory,
          )
          if (getClient instanceof Error) {
            cliLogger.warn(
              `Could not initialize OpenCode for ${channelConfig.directory}: ${getClient.message}`,
            )
          } else {
            client = getClient()
          }
        }
      } else {
        cliLogger.warn(
          `No mapped OpenCode session found for thread ${resolvedThreadId}`,
        )
      }

      await archiveThread({
        rest,
        threadId: resolvedThreadId,
        parentChannelId: threadData.parent_id,
        sessionId,
        client,
      })

      const threadLabel = threadData.name || resolvedThreadId
      note(
        `Archived thread: ${threadLabel}\nThread ID: ${resolvedThreadId}`,
        '✅ Archived',
      )
      process.exit(0)
    } catch (error) {
      cliLogger.error(
        'Error:',
        error instanceof Error ? error.stack : String(error),
      )
      process.exit(EXIT_NO_RESTART)
    }
  })

cli
  .command(
    'session abort <sessionId>',
    'Abort a running session without archiving the thread',
  )
  .action(async (sessionId) => {
    try {
      await initDatabase()

      const { token: botToken } = await resolveBotCredentials()
      const rest = createDiscordRest(botToken)

      // Try to resolve the project directory for the OpenCode abort call
      const directory = await resolveSessionDirectoryFromDatabase({ sessionId })
      if (directory instanceof Error) {
        cliLogger.error(directory.message)
        process.exit(EXIT_NO_RESTART)
      }

      const serverResult = await initializeOpencodeForDirectory(directory)
      if (serverResult instanceof Error) {
        cliLogger.error(`Failed to initialize OpenCode: ${serverResult.message}`)
        process.exit(EXIT_NO_RESTART)
      }

      const client = serverResult()
      // Don't pass directory — the server resolves sessions by ID regardless
      // of the x-opencode-directory header, matching archiveThread's pattern.
      // This avoids issues when --cwd was used (session directory != project directory).
      const abortResult = await client.session.abort({
        sessionID: sessionId,
      }).catch((e) => new Error('Failed to abort session', { cause: e }))
      if (abortResult instanceof Error) {
        cliLogger.error(abortResult.message)
        process.exit(EXIT_NO_RESTART)
      }

      // Post a message in the Discord thread so it's clear why the session stopped
      const threadId = await getThreadIdBySessionId(sessionId)
      if (threadId) {
        await rest.post(Routes.channelMessages(threadId), {
          body: { content: 'Session aborted via CLI' },
        }).catch((e) => {
          cliLogger.warn(`Could not post abort message to thread: ${e instanceof Error ? e.message : String(e)}`)
        })
      }

      note(
        `Aborted session: ${sessionId}${threadId ? `\nThread ID: ${threadId}` : ''}`,
        '✅ Aborted',
      )
      process.exit(0)
    } catch (error) {
      cliLogger.error(
        'Error:',
        error instanceof Error ? error.stack : String(error),
      )
      process.exit(EXIT_NO_RESTART)
    }
  })

cli
  .command(
    'session title <title>',
    'Update the OpenCode session title. Discord thread name follows automatically.',
  )
  .option('--session <sessionId>', 'OpenCode session ID')
  .option('--thread <threadId>', 'Discord thread ID')
  .example("kimaki session title 'Fix queue draining' --session ses_xxx")
  .action(async (title, options) => {
    try {
      await initDatabase()

      const trimmedTitle = title.trim()
      if (!trimmedTitle) {
        cliLogger.error('Title must not be empty')
        process.exit(EXIT_NO_RESTART)
      }
      if (options.session && options.thread) {
        cliLogger.error('Use either --session or --thread, not both')
        process.exit(EXIT_NO_RESTART)
      }
      if (!options.session && !options.thread) {
        cliLogger.error('Provide --session <sessionId> or --thread <threadId>')
        process.exit(EXIT_NO_RESTART)
      }

      const sessionId = await (async () => {
        if (options.session) return options.session
        const threadId = options.thread
        if (!threadId) return null
        return getThreadSession(threadId)
      })()
      if (!sessionId) {
        cliLogger.error(
          options.thread
            ? `No OpenCode session found for thread: ${options.thread}`
            : 'Provide --session <sessionId> or --thread <threadId>',
        )
        process.exit(EXIT_NO_RESTART)
      }

      const directory = await resolveSessionDirectoryFromDatabase({
        sessionId,
      })
      if (directory instanceof Error) {
        cliLogger.error(directory.message)
        process.exit(EXIT_NO_RESTART)
      }

      const serverResult = await initializeOpencodeForDirectory(directory)
      if (serverResult instanceof Error) {
        cliLogger.error(`Failed to initialize OpenCode: ${serverResult.message}`)
        process.exit(EXIT_NO_RESTART)
      }

      const updateResult = await serverResult()
        .session.update({
          sessionID: sessionId,
          title: trimmedTitle,
        })
        .catch((e) =>
          new OpenCodeSdkError({ operation: 'session.update', cause: e }),
        )
      if (updateResult instanceof Error) {
        cliLogger.error(updateResult.message)
        process.exit(EXIT_NO_RESTART)
      }
      if (updateResult.error) {
        cliLogger.error('OpenCode rejected the session title update')
        process.exit(EXIT_NO_RESTART)
      }

      note(`Updated OpenCode title: ${trimmedTitle}`, 'Title updated')
      process.exit(0)
    } catch (error) {
      cliLogger.error(
        'Error:',
        error instanceof Error ? error.stack : String(error),
      )
      process.exit(EXIT_NO_RESTART)
    }
  })

cli
  .command(
    'session discord-url <sessionId>',
    'Print the Discord thread URL for a session',
  )
  .option('--json', 'Output as JSON')
  .action(async (sessionId, options) => {
    await initDatabase()
    const threadId = await getThreadIdBySessionId(sessionId)
    if (!threadId) {
      cliLogger.error(`No Discord thread found for session: ${sessionId}`)
      process.exit(EXIT_NO_RESTART)
    }
    const { token: botToken } = await resolveBotCredentials()
    const rest = createDiscordRest(botToken)
    const threadData = (await rest.get(Routes.channel(threadId))) as {
      id: string
      guild_id: string
      name?: string
    }
    const url = `https://discord.com/channels/${threadData.guild_id}/${threadData.id}`
    if (options.json) {
      console.log(JSON.stringify({
        url,
        threadId: threadData.id,
        guildId: threadData.guild_id,
        sessionId,
        threadName: threadData.name,
      }))
    } else {
      console.log(url)
    }
    process.exit(0)
  })


export default cli
