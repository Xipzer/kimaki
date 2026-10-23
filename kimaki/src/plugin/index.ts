import type { JsonValue } from '@opencode/client'
import { Plugin, Skill } from '@opencode/plugin'
import type { SessionContext } from '@opencode/plugin/promise/session'
import { Schema } from 'effect'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

import { autostartBot } from '../autostart.ts'
import { readBuiltinSkills } from '../builtin-skills.ts'
import { fileEditTool, recordToolEdits } from '../file-edit-log.ts'
import { MESSAGE_MODE_INSTRUCTIONS, MESSAGE_TOOL, MESSAGE_TOOL_DESCRIPTION, MESSAGE_TOOL_INPUT, turnContext } from '../system-prompt.ts'

const exec = promisify(execFile)

const decodeSkill = Schema.decodeUnknownSync(Skill.Info)

const BRANCH_PREFIX = '[current git branch is '

export default Plugin.define({
  id: 'kimaki',
  async setup(ctx) {
    autostartBot()
    // Skills are per location, not per session, so OpenCode lists them in every
    // session, TUI included. Descriptions say they are for Kimaki sessions only;
    // the bot denies disabled ones per session (--disable-skills). A failed read
    // only loses the skills.
    const skills = await readBuiltinSkills()
    if (!(skills instanceof Error)) {
      await ctx.skill.transform((editor) => {
        for (const skill of skills) {
          editor.add(decodeSkill(skill))
        }
      })
    }
    // metadata.kimaki of the session, or of the thread's root for a subagent (`root: false`).
    async function marker(sessionID: string): Promise<{ fields: Map<string, JsonValue>; root: boolean } | null> {
      const session = await ctx.session.get({ sessionID }).catch(() => null)
      const value: unknown = session?.metadata?.['kimaki']
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null
      const current = new Map(Object.entries(value))
      if (!session?.parentID) return { fields: current, root: true }
      const parent = await ctx.session.get({ sessionID: session.parentID }).catch(() => null)
      const parentMarker = parent?.metadata?.['kimaki']
      if (parentMarker && typeof parentMarker === 'object' && !Array.isArray(parentMarker) && parentMarker['threadId'] === current.get('threadId')) {
        const root = await marker(session.parentID)
        return root && { fields: root.fields, root: false }
      }
      return { fields: current, root: true }
    }
    // Registered for every session; the context hook removes it outside message mode.
    await ctx.tool.transform((editor) => {
      editor.add({
        name: MESSAGE_TOOL,
        description: MESSAGE_TOOL_DESCRIPTION,
        input: MESSAGE_TOOL_INPUT,
        options: { codemode: false },
        // Discord renders the call input (thread-reducer.ts); the tool itself does nothing.
        execute: async () => ({ content: 'Message sent to the user.' }),
      })
    })
    // The git branch reaches the model as a synthetic message saved right before
    // the user prompt, only when it changed. Text in event.system would change the
    // cached prompt prefix on every branch switch. The prompt hook runs before
    // OpenCode admits the prompt, so the synthetic message is admitted first.
    await ctx.session.hook('prompt', async (event) => {
      if (!(await marker(event.sessionID))) return
      const branch = await exec('git', ['branch', '--show-current'], { cwd: ctx.location.directory, timeout: 5000 }).catch(() => null)
      const name = branch?.stdout.trim()
      if (!name) return
      const text = `${BRANCH_PREFIX}${name}]`
      const history = await ctx.session.context({ sessionID: event.sessionID }).catch(() => null)
      if (!history) return
      const last = history.findLast((message) => message.type === 'synthetic' && message.text.startsWith(BRANCH_PREFIX))
      if (last?.type === 'synthetic' && last.text === text) return
      await ctx.session.synthetic({ sessionID: event.sessionID, text, delivery: event.delivery, resume: false }).catch(() => undefined)
    })
    // Runs for every request kind: turns (context), compaction and generate (OpenCode
    // `warming` keep-alive requests). All kinds must get the same system text, tools
    // and messages, or the provider prompt cache misses.
    const shapeRequest = async (event: SessionContext) => {
      // The only prompt change for every session, TUI included. The ID never
      // changes in a session, so the cached prompt prefix stays stable.
      event.system.push({ type: 'text', text: `OpenCode session ID: ${event.sessionID}` })
      const info = await marker(event.sessionID)
      // send_message only for root sessions of a bot started with --message-tool.
      const messageMode = info?.root === true && info.fields.get('messageTool') === true
      if (!messageMode) delete event.tools[MESSAGE_TOOL]
      else event.system.push({ type: 'text', text: MESSAGE_MODE_INSTRUCTIONS })
      if (!info) return
      // The <discord-user> context of each prompt, built from its metadata, so the
      // stored text stays clean for the TUI and other clients. Same metadata, same
      // text on every request: the cached prompt prefix stays stable.
      for (const message of event.messages) {
        const context = message.role === 'user' ? turnContext(message.metadata) : null
        // TODO: build a new Message once plugins can import OpenCode's Message class;
        // a copy from another module instance may fail its instanceof checks.
        if (context) Array.prototype.push.call(message.content, { type: 'text', text: context })
      }
      // Extra inputs only for the Discord tool line. OpenCode decodes the real
      // inputs with Schema.Struct, which ignores unknown keys.
      const description = { type: 'string', description: 'Short 5-10 word summary shown in Discord' }
      const extras = {
        shell: { description, hasSideEffect: { type: 'boolean', description: 'True if Discord should show this command so the user is aware it runs. False hides it' } },
        execute: { description },
      }
      for (const [name, properties] of Object.entries(extras)) {
        const tool = event.tools[name]
        const input = tool?.input
        if (!tool || !input || typeof input !== 'object' || Array.isArray(input)) continue
        tool.input = { ...input, properties: {
          ...(input.properties && typeof input.properties === 'object' ? input.properties : {}),
          ...properties,
        } }
      }
    }
    await ctx.session.hook('context', shapeRequest)
    await ctx.session.hook('compaction', shapeRequest)
    await ctx.session.hook('generate', shapeRequest)
    await ctx.tool.hook('execute.before', async (event) => {
      if (event.tool !== 'shell' || !event.input || typeof event.input !== 'object' || Array.isArray(event.input)) return
      const info = await marker(event.sessionID)
      const dataDir = info?.fields.get('dataDir')
      const lockPort = info?.fields.get('lockPort')
      if (typeof dataDir !== 'string' || typeof lockPort !== 'number') return
      if (!('command' in event.input) || typeof event.input.command !== 'string') return
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
      event.input.command = `export PATH=${quote(path.join(dataDir, 'bin'))}:"$PATH" KIMAKI_DATA_DIR=${quote(dataDir)} KIMAKI_LOCK_PORT=${quote(String(lockPort))} KIMAKI_TOOL_CALL=${quote(`${event.messageID}:${event.id}`)}; ${event.input.command}`
    })
    // File edits feed `kimaki session editors` (v1-compatible JSONL index).
    await ctx.tool.hook('execute.after', async (event) => {
      if (event.status !== 'completed' || !fileEditTool(event.tool)) return
      const dataDir = (await marker(event.sessionID))?.fields.get('dataDir')
      if (typeof dataDir !== 'string') return
      // Plugins stay silent: a failed append only loses one index entry.
      const recorded = await recordToolEdits({ dataDir, directory: ctx.location.directory, sessionId: event.sessionID, tool: event.tool, input: event.input })
      if (recorded instanceof Error) return
    })
  },
})
