// OpenCode V2 plugin: on rate limit, quota, overload or auth errors, record a
// block in plugin storage, then move the failing session to the best
// (model, account) pair that is not blocked, and retry the same step.
//
// - Model changes are per session (session.switchModel). The plugin never
//   moves a session back up by itself, so prompt caches survive.
// - Account changes are global per integration (credential.activate): a
//   blocked account is blocked for every session.
// - Accounts come from normal OpenCode logins (`opencode auth login`, /connect).
// - After a model switch, session metadata `fallback` records it and every
//   request of that session gets a system note, so the new model knows its
//   abilities may differ from the old one.
// - Retry hook errors carry no headers, so http.response keeps the headers of
//   the last failed response per session for exact reset times.
// - A saved login is only activated after its token resolves (refreshes). RPC
//   `keepalive` does the same check for every saved login, so a login that sits
//   unused keeps a valid token and a dead one is known before it is needed.

import { Plugin, Rpc } from '@opencode/plugin'
import {
  blockKey,
  classify,
  DEFAULT_BLOCK_MS,
  DEFAULT_MODELS,
  ENV_ACCOUNT,
  formatModel,
  isDeadLogin,
  parseModel,
  pick,
  isBlock,
  isModelSwitch,
  nextSwitch,
  switchNote,
  type Block,
  type ModelRef,
} from './fallback.ts'

export * from './fallback.ts'

const OBJECT = { type: 'object' } as const

// `client.rpc(FallbackRpc)` reads blocks and receives `switched` events
// (`rpc.fallback.switched` on the event stream).
export const FallbackRpc = Rpc.define({
  id: 'fallback',
  methods: {
    blocks: { input: OBJECT, output: OBJECT },
    // Removes blocks: all, or those of `credentialID`.
    clear: { input: OBJECT, output: OBJECT },
    // Resolves every saved login of the ranked providers. Run it on a schedule.
    keepalive: { input: OBJECT, output: OBJECT },
  },
  events: {
    switched: { schema: OBJECT },
  },
})

export default Plugin.define({
  id: 'fallback',
  async setup(ctx) {
    const ranking = (Array.isArray(ctx.options.models) ? ctx.options.models : DEFAULT_MODELS)
      .flatMap((entry) => (typeof entry === 'string' ? [parseModel(entry)] : []))
      .filter((model) => model !== undefined)

    // Last model request per session: which account it used, and the headers when it failed.
    const requests = new Map<string, { kind: string; credentialID: string; headers?: Record<string, string> }>()

    async function integrationOf(providerID: string) {
      const provider = await ctx.provider.get({ providerID }).catch(() => undefined)
      return provider?.data.integrationID ?? providerID
    }

    async function activeCredential(providerID: string) {
      const active = await ctx.integration.connection.active(await integrationOf(providerID)).catch(() => undefined)
      return active?.type === 'credential' ? active.id : ENV_ACCOUNT
    }

    // Saved accounts of a provider, active first.
    async function accountsOf(providerID: string) {
      const integration = await ctx.integration.get({ integrationID: await integrationOf(providerID) }).catch(() => undefined)
      const ids = (integration?.data.connections ?? []).flatMap((item) => (item.type === 'credential' ? [item.id] : []))
      return ids.length === 0 ? [ENV_ACCOUNT] : ids
    }

    const AUTH_RECHECK_MS = 10 * 60_000
    // An access token lives for hours and its refresh token only stays valid while it
    // is used: every saved login is resolved this often, also the ones no session uses.
    const KEEPALIVE_EVERY_MS = 60 * 60_000
    const KEEPALIVE_CHECK_MS = 10 * 60_000

    // Resolving refreshes an expiring OAuth token now, so a dead refresh token fails here, not in the retried step.
    // Returns the block to save when the login is not usable: a day for a dead login,
    // minutes when the token service did not answer (it may be back soon).
    async function loginBlock({ providerID, credentialID, now }: { providerID: string; credentialID: string; now: number }): Promise<{ block: Block; error: string } | undefined> {
      const integration = await ctx.integration.get({ integrationID: await integrationOf(providerID) }).catch(() => undefined)
      const connection = integration?.data.connections.find((item) => item.type === 'credential' && item.id === credentialID)
      if (!connection) return undefined
      const error = await ctx.integration.connection.resolve(connection).then(() => undefined, (cause) => String(cause?.message ?? cause))
      if (error === undefined) return undefined
      const until = now + (isDeadLogin(error) ? DEFAULT_BLOCK_MS.auth : AUTH_RECHECK_MS)
      return { block: { providerID, credentialID, modelID: '*', until, reason: 'auth' }, error }
    }

    async function readBlocks(now: number) {
      const blocks: Block[] = []
      let after: string | undefined
      do {
        const page = await ctx.storage.scan({ prefix: 'block/', after, limit: 1000 })
        for (const entry of page.entries) {
          if (!isBlock(entry.value) || entry.value.until <= now) await ctx.storage.remove(entry.key)
          else blocks.push(entry.value)
        }
        after = page.next
      } while (after)
      return blocks
    }

    async function saveBlock(block: Block) {
      const key = blockKey(block)
      const existing = await ctx.storage.get(key)
      if (isBlock(existing) && existing.until >= block.until) return
      await ctx.storage.set(key, block)
    }

    // Ranking filtered to models this location can use. The failed model keeps its
    // own variant; a model outside the ranking is tried first (other accounts).
    async function rankingFor(failed: ModelRef) {
      const models = await ctx.model.list()
      const usable = ranking.filter((model) =>
        models.data.some(
          (info) =>
            info.providerID === model.providerID &&
            info.id === model.id &&
            (!model.variant || info.variants.some((variant) => variant.id === model.variant)),
        ),
      )
      const same = (model: ModelRef) => model.providerID === failed.providerID && model.id === failed.id
      if (!usable.some(same)) return [failed, ...usable]
      return usable.map((model) => (same(model) ? failed : model))
    }

    const rankedProviders = [...new Set(ranking.map((model) => model.providerID))]

    async function clearBlocks(credentialID: string | undefined, reason?: Block['reason']) {
      let removed = 0
      let after: string | undefined
      do {
        const page = await ctx.storage.scan({ prefix: 'block/', after, limit: 1000 })
        for (const entry of page.entries) {
          if (isBlock(entry.value) && ((credentialID && entry.value.credentialID !== credentialID) || (reason && entry.value.reason !== reason))) continue
          await ctx.storage.remove(entry.key)
          removed++
        }
        after = page.next
      } while (after)
      return removed
    }

    // Every saved login of the ranked providers: resolve it (refreshing an expiring
    // token), block the ones that fail. When the active login is dead and another
    // one works, that one becomes active, so sessions do not fail until someone logs in.
    async function keepalive() {
      const now = Date.now()
      const logins: Array<{ providerID: string; credentialID: string; label: string; active: boolean; state: 'ok' | 'dead' | 'unreachable'; error?: string }> = []
      const activated: string[] = []
      for (const providerID of rankedProviders) {
        const integration = await ctx.integration.get({ integrationID: await integrationOf(providerID) }).catch(() => undefined)
        if (!integration) continue
        const active = await activeCredential(providerID)
        const checked: typeof logins = []
        for (const connection of integration.data.connections) {
          if (connection.type !== 'credential') continue
          const failed = await loginBlock({ providerID, credentialID: connection.id, now })
          const dead = failed !== undefined && isDeadLogin(failed.error)
          if (failed) await saveBlock(failed.block)
          // OpenCode shows a login that needs a new sign-in; it is cleared when the login works again.
          const recovered = !failed && (await clearBlocks(connection.id, 'auth')) > 0
          if (dead || recovered) {
            const status = dead ? { status: 'needs_auth' as const, message: 'This login can no longer renew its token. Sign in again.' } : undefined
            await ctx.integration.connection.status({ integrationID: integration.data.id, connection, status }).catch(() => undefined)
          }
          checked.push({
            providerID,
            credentialID: connection.id,
            label: connection.label ?? connection.id,
            active: connection.id === active,
            state: !failed ? 'ok' : dead ? 'dead' : 'unreachable',
            ...(failed && { error: failed.error.slice(0, 300) }),
          })
        }
        const blocks = await readBlocks(now)
        const next = checked.find((login) => login.state === 'ok' && !blocks.some((block) => block.providerID === providerID && block.modelID === '*' && (block.credentialID === '*' || block.credentialID === login.credentialID)))
        if (checked.some((login) => login.active && login.state === 'dead') && next) {
          await ctx.credential.activate({ credentialID: next.credentialID })
          activated.push(next.credentialID)
        }
        logins.push(...checked)
      }
      await ctx.storage.set('keepalive/last', now)
      return { logins, activated }
    }

    const rpc = await ctx.rpc.register(FallbackRpc, {
      // `keepalive`: when the saved logins were last checked (epoch ms), null before the first round.
      blocks: async () => ({ blocks: await readBlocks(Date.now()), keepalive: (await ctx.storage.get('keepalive/last')) ?? null }),
      clear: async (input) => {
        const credentialID = input && typeof input === 'object' && 'credentialID' in input && typeof input.credentialID === 'string' ? input.credentialID : undefined
        return { removed: await clearBlocks(credentialID) }
      },
      keepalive,
    })

    await ctx.session.hook('model.request', async (event) => {
      requests.set(event.sessionID, { kind: event.kind, credentialID: await activeCredential(event.model.providerID) })
    })

    await ctx.session.hook('http.response', (event) => {
      if (event.response.ok) return
      const request = requests.get(event.sessionID)
      if (!request) return
      request.headers = Object.fromEntries(event.response.headers)
    })

    await ctx.session.hook('retry', async (event) => {
      const request = requests.get(event.sessionID)
      requests.delete(event.sessionID)
      // Compaction keeps its prepared request across retries, so a model switch would not apply.
      if (request && request.kind !== 'primary') return
      const now = Date.now()
      const block = classify({
        failed: {
          model: event.model,
          credentialID: request?.credentialID ?? ENV_ACCOUNT,
          error: event.error,
          headers: request?.headers,
        },
        now,
      })
      if (!block) return
      await saveBlock(block)

      const candidates = await rankingFor(event.model)
      const providers = [...new Set(candidates.map((model) => model.providerID))]
      const accounts = Object.fromEntries(
        await Promise.all(providers.map(async (providerID) => [providerID, await accountsOf(providerID)] as const)),
      )
      const blocks = await readBlocks(now)
      let choice = pick({ ranking: candidates, accounts, blocks, now })
      // Each failed check blocks the chosen account, so the loop ends. A waiting choice
      // is not checked: its token may be refreshed before the wait ends.
      while (choice && choice.waitUntil === undefined) {
        const failed = await loginBlock({ providerID: choice.model.providerID, credentialID: choice.credentialID, now })
        if (!failed) break
        await saveBlock(failed.block)
        blocks.push(failed.block)
        choice = pick({ ranking: candidates, accounts, blocks, now })
      }
      if (!choice) return

      if (choice.credentialID !== ENV_ACCOUNT && (await activeCredential(choice.model.providerID)) !== choice.credentialID) {
        await ctx.credential.activate({ credentialID: choice.credentialID })
      }
      await ctx.session.switchModel({ sessionID: event.sessionID, model: choice.model })
      if (choice.model.providerID !== event.model.providerID || choice.model.id !== event.model.id) {
        const session = await ctx.session.get({ sessionID: event.sessionID }).catch(() => undefined)
        const previous = session?.metadata?.fallback
        const fallback = nextSwitch({ previous: isModelSwitch(previous) ? previous : undefined, failed: event.model, to: choice.model, reason: block.reason })
        if (session) await ctx.session.update({ sessionID: event.sessionID, metadata: { ...session.metadata, fallback } }).catch(() => undefined)
      }
      event.decision = { retry: true, delay: choice.waitUntil === undefined ? 0 : Math.max(0, choice.waitUntil - now) }

      await rpc.events.emit('switched', {
        sessionID: event.sessionID,
        from: formatModel(event.model),
        to: formatModel(choice.model),
        credentialID: choice.credentialID,
        reason: block.reason,
        blockedUntil: block.until,
        // The RPC event encoder rejects undefined values, so omit the key.
        ...(choice.waitUntil === undefined ? {} : { waitUntil: choice.waitUntil }),
      })
    })

    // The retried step builds its request again, so the note is there before the new
    // model answers. It only changes at a switch, which loses the prompt cache anyway.
    async function addSwitchNote(event: { sessionID: string; model: ModelRef; system: Array<{ type: 'text'; text: string }> }) {
      const session = await ctx.session.get({ sessionID: event.sessionID }).catch(() => undefined)
      const value = session?.metadata?.fallback
      const note = switchNote({ value: isModelSwitch(value) ? value : undefined, model: event.model })
      if (note) event.system.push({ type: 'text', text: note })
    }
    // All three, so warmup and compaction requests keep the same cached prefix.
    await ctx.session.hook('context', addSwitchNote)
    await ctx.session.hook('compaction', addSwitchNote)
    await ctx.session.hook('generate', addSwitchNote)

    // The plugin runs once per location and storage is shared: the stored time of
    // the last round lets one of them do it. A round only talks to the provider
    // for a token that is about to expire.
    async function keepaliveWhenDue() {
      const now = Date.now()
      const last = await ctx.storage.get('keepalive/last')
      if (typeof last === 'number' && now - last < KEEPALIVE_EVERY_MS) return
      await keepalive()
    }
    const run = () => void keepaliveWhenDue().catch(() => undefined)
    const soon = setTimeout(run, 30_000 + Math.random() * 30_000)
    const timer = setInterval(run, KEEPALIVE_CHECK_MS)
    soon.unref?.()
    timer.unref?.()
    return () => {
      clearTimeout(soon)
      clearInterval(timer)
    }
  },
})
