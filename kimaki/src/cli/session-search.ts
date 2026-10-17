// Fork: `kimaki session search`, removed upstream in 1.1 (b1e72f63) in favour
// of `session sync` + rg. Kept because existing scripts call
// `kimaki session search <query> --all --days N --json`. Same behaviour as
// kimaki 1.0.0: titles first, then message content, newest pages first.

import type { Goke } from 'goke'

import { OpenCodeError } from '../errors.ts'
import { allSessions } from '../session-events.ts'
import { DATA_DIR_HELP, fail, printRows, projectDirectory, readClient } from './shared.ts'

export function registerSessionSearchCommand(cli: Goke) {
  cli.command('session search <query>', 'Search titles, then real message content')
    .option('--data-dir <path>', DATA_DIR_HELP)
    .option('--project <path>', 'Project (default: current directory)')
    .option('-c, --channel <id>', 'Project of this Discord channel')
    .option('--all', 'All projects')
    .option('--days <n>', 'Recent days (default: 14; 0 = all)')
    .option('--json', 'Output as JSON')
    .action(async (query, options) => {
      const client = await readClient()
      const directory = options.all ? undefined : await projectDirectory({ project: options.project, channel: options.channel, dataDir: options.dataDir })
      const sessions = await allSessions({ client, directory })
      if (sessions instanceof Error) fail(sessions)
      // `/pattern/flags` is a regular expression, anything else a case-insensitive substring.
      const pattern = query.match(/^\/(.*)\/([dgimsuvy]*)$/)
      const expression = pattern ? new RegExp(pattern[1]!, pattern[2]) : null
      const matches = (text: string) => {
        if (!expression) return text.toLowerCase().includes(query.toLowerCase())
        expression.lastIndex = 0
        return expression.test(text)
      }
      const days = Number(options.days ?? 14)
      if (!Number.isFinite(days) || days < 0) fail(new Error('--days must be a non-negative number'))
      const recent = sessions.filter((session) => !days || session.time.updated >= Date.now() - days * 86400000)
      // OpenCode has no content search API: scan pages newest first, stop at the first hit.
      const hit = async (session: (typeof sessions)[number]) => {
        if (matches(session.title ?? '')) return true
        const scan = async (cursor: string | undefined): Promise<OpenCodeError | boolean> => {
          const page = await client.message.list({ sessionID: session.id, limit: 200, ...(cursor ? { cursor } : { order: 'desc' as const }) })
            .catch((cause) => new OpenCodeError({ operation: 'message.list', cause }))
          if (page instanceof Error) return page
          if (page.data.some((message) => matches(message.type === 'user' ? message.text : JSON.stringify(message)))) return true
          return page.cursor.next ? scan(page.cursor.next) : false
        }
        return scan(undefined)
      }
      // 8 sessions at a time.
      const results: boolean[] = new Array(recent.length)
      const next = { index: 0 }
      await Promise.all(Array.from({ length: Math.min(8, recent.length) }, async () => {
        while (next.index < recent.length) {
          const index = next.index++
          const result = await hit(recent[index]!)
          if (result instanceof Error) fail(result)
          results[index] = result
        }
      }))
      const found = recent.filter((_, index) => results[index])
      printRows({ json: options.json, rows: found, line: (session) => `${session.id} ${session.title}` })
    })
}
