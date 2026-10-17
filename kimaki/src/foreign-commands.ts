// Fork: guild command registration keeps slash commands that other apps or
// processes register on the same Discord application (for example Wendy's
// /wendy and /whisper-* commands). Upstream bulk-PUTs only Kimaki's list,
// which deletes them on every bot start and catalog change.
//
//   live guild commands ─▶ owned by Kimaki? ─▶ yes: replaced by the built list
//                                         └─▶ no:  sent back unchanged
//
// A command is Kimaki's when it is in the current list, has a dynamic suffix,
// or is a name an earlier Kimaki registered (V1 and earlier V2 releases), so a
// command Kimaki stopped registering is still cleaned up.

import type { APIApplicationCommand, RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord-api-types/v10'

export const MAX_GUILD_COMMANDS = 100

const DYNAMIC_SUFFIX = /-(agent|cmd|skill|mcp-prompt)$/

const LEGACY_KIMAKI_COMMANDS: ReadonlySet<string> = new Set([
  'abort', 'accept', 'accept-always', 'add-dir', 'add-directory', 'add-new-project', 'add-project', 'agent', 'btw',
  'clear-queue', 'compact', 'context-usage', 'create-new-project', 'diff', 'disable-worktrees', 'enable-worktrees', 'fork',
  'fork-subagent', 'last-sessions', 'login', 'mcp', 'memory-snapshot', 'merge-worktree', 'model', 'model-variant',
  'new-session', 'new-worktree', 'queue', 'queue-command', 'redo', 'reject', 'remove-project', 'restart-opencode-server',
  'resume', 'resume-session', 'run-shell-command', 'screenshare', 'screenshare-stop', 'session', 'session-id', 'share',
  'sqlitedb', 'stop', 'stop-opencode-server', 'tasks', 'toggle-mention-mode', 'toggle-worktrees', 'transcription-key',
  'transcription-url', 'undo', 'unset-model-override', 'upgrade-and-restart', 'verbosity', 'vscode', 'worktrees',
])

// KIMAKI_PRESERVE_COMMANDS=deploy-cmd,foo-* keeps matching names even when
// they look like Kimaki's. Names Kimaki registers now always stay Kimaki's.
export function preservePatterns(raw: string | undefined): RegExp[] {
  return (raw ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => new RegExp(`^${part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`))
}

export function isKimakiCommand({ name, current, preserve = [] }: { name: string; current: ReadonlySet<string>; preserve?: readonly RegExp[] }): boolean {
  if (current.has(name)) return true
  if (preserve.some((pattern) => pattern.test(name))) return false
  return LEGACY_KIMAKI_COMMANDS.has(name) || DYNAMIC_SUFFIX.test(name)
}

export type ForeignCommand = Omit<APIApplicationCommand, 'application_id' | 'guild_id' | 'version' | 'name_localized' | 'description_localized' | 'default_permission'>

// Response-only fields are stripped; `id` is accepted by the bulk PUT and keeps the command in place.
export function toForeignCommand(command: APIApplicationCommand): ForeignCommand {
  const {
    application_id: _applicationId,
    guild_id: _guildId,
    version: _version,
    name_localized: _nameLocalized,
    description_localized: _descriptionLocalized,
    default_permission: _defaultPermission,
    ...rest
  } = command
  return rest
}

// Kimaki's fixed commands always fit; dynamic ones (in catalog priority order,
// last first) give way to foreign commands, and foreign ones past the limit are dropped.
export function mergeForeignCommands({
  built,
  fixedCount,
  live,
  preserve = [],
  limit = MAX_GUILD_COMMANDS,
}: {
  built: readonly RESTPostAPIChatInputApplicationCommandsJSONBody[]
  fixedCount: number
  live: readonly APIApplicationCommand[]
  preserve?: readonly RegExp[]
  limit?: number
}): {
  commands: Array<RESTPostAPIChatInputApplicationCommandsJSONBody | ForeignCommand>
  kept: string[]
  skipped: string[]
  droppedForeign: string[]
} {
  const current = new Set(built.map((command) => command.name))
  const foreign = live.filter((command) => !isKimakiCommand({ name: command.name, current, preserve })).map(toForeignCommand)
  const fixed = built.slice(0, fixedCount)
  const room = Math.max(0, limit - fixed.length)
  const keptForeign = foreign.slice(0, room)
  const dynamic = built.slice(fixedCount, fixedCount + Math.max(0, room - keptForeign.length))
  return {
    commands: [...fixed, ...dynamic, ...keptForeign],
    kept: keptForeign.map((command) => command.name),
    skipped: built.slice(fixedCount + dynamic.length).map((command) => command.name),
    droppedForeign: foreign.slice(room).map((command) => command.name),
  }
}
