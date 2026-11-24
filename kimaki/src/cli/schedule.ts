// `send`, `routine ...` and `sleep`: start, schedule and wake sessions through
// the running bot. scheduler.ts is bot code: only `routine list` loads it, lazily.

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { wrapJsonSchema, type Goke } from 'goke'

import { BotNotRunningError } from '../errors.ts'
import { callBot } from '../lock-server.ts'
import { action, DATA_DIR_HELP, dataDirOrDefault, discordApi, fail, openCliDb, parseTarget, printJson, readClient, SESSION_HELP, targetOrEnv, waitAndPrintSessions } from './shared.ts'

// Bare `--wait`: long enough that the shell timeout ends it first.
const DEFAULT_WAIT_SECONDS = 24 * 60 * 60

export function registerSendCommand(cli: Goke) {
  cli.command('send', 'Start a session in a channel, or continue a thread')
    .option('--data-dir <path>', DATA_DIR_HELP)
    .option('-c, --channel <id>', 'New thread in this channel')
    .option('-d, --project <path>', 'Project directory of the new thread')
    .option('--thread <id>', 'Continue this thread (ID or URL)')
    .option('-s, --session <id>', 'Continue this session: session ID, thread ID or thread URL')
    .option('-p, --prompt <text>', 'Prompt; thread suffixes . queue and . btw are supported').required()
    .option('-f, --file <path>', wrapJsonSchema<string[]>({ type: 'array', items: { type: 'string' }, description: 'Attach a local file (repeatable)' }))
    .option('-n, --name <text>', 'Thread name')
    .option('--agent <name>', 'Agent ID')
    .option('--model <provider/model>', 'Model for the new session')
    .option('-u, --user <id>', wrapJsonSchema<string[]>({ type: 'array', items: { type: 'string' }, description: 'Add this Discord user to the thread (repeatable)' }))
    .option('--cwd <path>', 'Existing project subfolder or linked Git worktree')
    .option('--worktree [name]', 'Create a custom Git worktree (automatic name when omitted)')
    .option('--base-branch <ref>', 'Starting ref for --worktree (default: project HEAD)')
    .option('--parent-session <id>', 'Record the parent session in session metadata')
    .option('--permission <rule>', wrapJsonSchema<string[]>({ type: 'array', items: { type: 'string' }, description: 'Repeatable: tool[:pattern]:allow|deny|ask' }))
    .option('--notify-only', 'Post a notification thread without a model turn')
    .option('--wait [seconds]', 'Wait until idle or input is needed (at most this many seconds, default 1 day), then print the session')
    .option('--send-at <when>', 'Schedule: UTC ISO date ending in Z, or cron expression (UTC)')
    .option('--pre-run <command>', 'Scheduled only: run first in the project. Exit 0 starts, stdout is appended')
    .option('--allow-concurrency', 'Scheduled only: allow overlapping runs of this routine')
    .option('--host <ssh-alias>', 'Send on another machine over ssh, naming this session there so both sides link (fork)')
    .option('--from-session <id>', 'Sending session on another machine (set by --host)')
    .option('--from-thread <id>', 'Thread of the sending session (set by --host)')
    .option('--from-machine <name>', 'Machine of the sending session (set by --host)')
    .action(async (options) => {
      // Fork: linked sessions across machines (session-links.ts).
      if (options.host) return sendOverSsh({ host: String(options.host), dataDir: options.dataDir })
      const wait = options.wait === undefined ? undefined : options.wait === '' ? DEFAULT_WAIT_SECONDS : Number(options.wait)
      if (wait !== undefined && !(Number.isFinite(wait) && wait > 0 && wait <= DEFAULT_WAIT_SECONDS)) fail(new Error('--wait takes a positive number of seconds, at most 86400'))
      if (wait !== undefined && options.sendAt) fail(new Error('--wait cannot be used with --send-at: the routine runs later'))
      if (options.thread !== undefined && options.session !== undefined) fail(new Error('Use exactly one of --channel, --thread, --session, --project'))
      const continued = options.thread ?? options.session
      const target = continued === undefined ? {} : parseTarget(continued)
      if (target instanceof Error) fail(target)
      const input = {
        channelId: options.channel, project: options.project, ...target,
        prompt: options.prompt, name: options.name, agent: options.agent, model: options.model, user: options.user,
        cwd: options.cwd, worktree: options.worktree, baseBranch: options.baseBranch, parentSessionId: options.parentSession,
        permissions: options.permission, notifyOnly: options.notifyOnly,
        sourceSessionId: options.fromSession, sourceThreadId: options.fromThread, sourceMachine: options.fromMachine,
        files: (options.file ?? []).map((file) => ({ uri: pathToFileURL(path.resolve(file)).href, name: path.basename(file) })),
      }
      const result = await callBot({
        dataDir: dataDirOrDefault(options.dataDir),
        route: 'send',
        signal: AbortSignal.timeout(25 * 60_000),
        input: {
          ...input, wait, sendAt: options.sendAt, preRun: options.preRun, allowConcurrency: options.allowConcurrency,
          senderSessionId: process.env['OPENCODE_SESSION_ID'] || undefined,
        },
      })
      if (result instanceof BotNotRunningError) {
        // No local bot (CI, another machine): the bot that owns the channel runs it (remote-send.ts).
        if (options.sendAt || wait !== undefined) fail(new Error('Kimaki bot is not running here. --send-at and --wait need a local bot.'))
        const [{ sendInput }, { sendWithoutBot }] = await Promise.all([import('../lock-routes.ts'), import('../remote-send.ts')])
        const parsed = sendInput.safeParse(input)
        if (!parsed.success) fail(new Error(parsed.error.issues.map((issue) => issue.message).join('; ')))
        const { api } = await discordApi(options.dataDir)
        const sent = await sendWithoutBot({ api, input: parsed.data })
        if (sent instanceof Error) fail(sent)
        process.stdout.write(`${JSON.stringify(sent)}\n`)
        return
      }
      if (result instanceof Error) fail(result)
      process.stdout.write(`${JSON.stringify(result.data)}\n`)
      if (wait === undefined) return
      const data = result.data
      if (!data || typeof data !== 'object' || !('sessionId' in data) || typeof data.sessionId !== 'string') fail(new Error('--wait requires an AI session, not --notify-only'))
      await waitAndPrintSessions({
        client: await readClient(),
        sessionIds: [data.sessionId],
        dataDir: options.dataDir,
        signal: AbortSignal.timeout(wait * 1000),
        timeout: `${wait}s`,
      })
    })
}

// Fork: `kimaki send --host <alias> ...` runs the same send on that machine with
// --from-* naming this session, prints its answer and links both sides here.
export function remoteSendArgs({ argv, from }: { argv: readonly string[]; from: { session?: string; thread?: string; machine: string } }): string[] {
  const args: string[] = []
  for (let i = argv.indexOf('send') + 1; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--host') { i++; continue }
    if (arg.startsWith('--host=') || arg === '--data-dir' || arg.startsWith('--data-dir=') || arg.startsWith('--from-')) {
      if (!arg.includes('=')) i++
      continue
    }
    args.push(arg)
  }
  if (from.session) args.push('--from-session', from.session)
  if (from.thread) args.push('--from-thread', from.thread)
  args.push('--from-machine', from.machine)
  return args
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

async function sendOverSsh({ host, dataDir }: { host: string; dataDir: string | undefined }) {
  const [{ execFile }, { promisify }, os] = await Promise.all([import('node:child_process'), import('node:util'), import('node:os')])
  const self = process.env['OPENCODE_SESSION_ID'] || undefined
  let thread: string | undefined
  if (self) {
    const opened = await openCliDb(dataDir)
    const row = await opened.db.query.thread_sessions.findFirst({ where: { session_id: self } }).catch(() => undefined)
    opened.close()
    thread = row?.thread_id
  }
  const args = remoteSendArgs({ argv: process.argv, from: { session: self, thread, machine: os.hostname() } })
  const command = `export PATH="$HOME/.kimaki/bin:$HOME/.local/bin:$HOME/.bun/bin:$PATH"; kimaki send ${args.map(shellQuote).join(' ')}`
  const ran = await promisify(execFile)('ssh', ['-o', 'BatchMode=yes', host, command], { maxBuffer: 64 * 1024 * 1024, timeout: 26 * 60_000 })
    .catch((error: Error & { stdout?: string; stderr?: string }) => error)
  if (ran instanceof Error) fail(new Error(`send on ${host} failed: ${(ran.stderr || ran.message).trim()}`))
  process.stdout.write(ran.stdout)
  const first = ran.stdout.split('\n').find((line) => line.startsWith('{'))
  const answer = first ? (JSON.parse(first) as { threadId?: unknown; sessionId?: unknown }) : null
  if (!self || !answer || typeof answer.threadId !== 'string') return
  const sessionId = typeof answer.sessionId === 'string' ? answer.sessionId : `thread:${answer.threadId}`
  const linked = await callBot({
    dataDir: dataDirOrDefault(dataDir),
    route: 'session.links',
    signal: AbortSignal.timeout(30_000),
    input: { sessionId: self, add: sessionId, remoteThreadId: answer.threadId, remoteMachine: host },
  })
  if (linked instanceof Error) process.stderr.write(`linked on ${host}, but not here: ${linked.message}\n`)
}

// routine list / edit / delete / run, sleep
export function registerScheduleCommands(cli: Goke) {
  // `task` is the V1 name of `routine`: same commands, hidden from help.
  for (const noun of ['routine', 'task'] as const) {
    const hide = <C extends { hidden(): unknown }>(command: C): C => {
      if (noun === 'task') command.hidden()
      return command
    }

    hide(cli.command(`${noun} list`, 'List routines (planned, running, failed)'))
      .option('--data-dir <path>', DATA_DIR_HELP)
      .option('--json', 'Output as JSON')
      .option('--all', 'Also list finished and cancelled V1 routines')
      .action(async (options) => {
        const { listTasks } = await import('../scheduler.ts')
        const opened = await openCliDb(options.dataDir)
        const routines = await listTasks({ db: opened.db, all: options.all })
        opened.close()
        if (routines instanceof Error) fail(routines)
        if (options.json) return printJson(routines)
        if (routines.length === 0) {
          process.stdout.write('No routines\n')
          return
        }
        const header = 'id | status | schedule | nextRunAt | channel | thread | user | agent | model | preRun | allowConcurrency | prompt'
        const rows = routines.map((routine) =>
          [routine.id, routine.status, routine.schedule, routine.nextRunAt, routine.channelId, routine.threadId, routine.userId, routine.agent, routine.model, routine.preRun, routine.allowConcurrency, routine.prompt]
            .map((value) => value ?? '-')
            .join(' | '),
        )
        process.stdout.write(`${[header, ...rows].join('\n')}\n`)
      })

    hide(cli.command(`${noun} edit <routineId>`, 'Change a planned routine. An empty string clears a value'))
      .option('--data-dir <path>', DATA_DIR_HELP)
      .option('--prompt <text>', 'New prompt')
      .option('--send-at <when>', 'New schedule: UTC ISO date ending in Z, or cron (UTC)')
      .option('--agent <name>', 'Agent for the scheduled session')
      .option('--model <provider/model>', 'Model for the scheduled session')
      .option('-u, --user <id>', 'Discord user ID added to each run\'s thread')
      .option('--pre-run <command>', 'Command to run before each run')
      .option('--allow-concurrency <bool>', 'true | false')
      .action(async (routineId, options) => {
        const flag = options.allowConcurrency
        if (flag && flag !== 'true' && flag !== 'false') fail(new Error('--allow-concurrency must be true or false'))
        await action({ route: 'task.edit', dataDir: options.dataDir, input: {
          id: Number(routineId), prompt: options.prompt, sendAt: options.sendAt, agent: options.agent, model: options.model,
          user: options.user, preRun: options.preRun, allowConcurrency: flag ? flag === 'true' : undefined,
        } })
      })

    for (const [name, description] of [['delete', 'Delete a routine'], ['run', 'Run a routine now']] as const) {
      hide(cli.command(`${noun} ${name} <routineId>`, description))
        .option('--data-dir <path>', DATA_DIR_HELP)
        .action(async (routineId, options) => {
          // A run waits for its pre-run command (up to 10 minutes) and the session start.
          const signal = name === 'run' ? AbortSignal.timeout(12 * 60_000) : undefined
          await action({ route: `task.${name}`, dataDir: options.dataDir, input: { id: Number(routineId) }, signal })
        })
    }
  }

  cli.command('sleep', 'Wake this session later with a new message in the same thread. Run it last, after your text. To monitor slow events (email replies, PR reviews), wait 2h or more; never poll every few minutes. When blocked on a user action outside the chat (a sudo or permission dialog, a login), ask for it, assume they will do it, and sleep 5m, then check and continue on your own')
    .option('--data-dir <path>', DATA_DIR_HELP)
    .option('--duration <duration>', 'Relative wait, e.g. 30m, 2h, 1d')
    .option('--until <date>', 'UTC ISO date ending in Z')
    .option('--reason <text>', 'Shown in Discord and in the wake message')
    .option('-s, --session <id>', SESSION_HELP)
    .action(async (options) => {
      // The bot parses --duration/--until with its own clock (scheduler.ts parseWakeAt).
      const result = await callBot({ dataDir: dataDirOrDefault(options.dataDir), route: 'sleep', input: {
        ...targetOrEnv(options.session), duration: options.duration, until: options.until, reason: options.reason,
      } })
      if (result instanceof Error) fail(result)
      process.stdout.write(`${result.data.output}\n`)
    })
}
