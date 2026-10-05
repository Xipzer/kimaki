import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { archiveRemovedAccount, readAccountStoreJson, removedAccountsLogPath, writeJson } from './oauth-rotation-shared.js'
import { accountsFilePath, loadAccountStore, removeAccount, saveAccountStore } from './anthropic-auth-state.js'

let dir: string
const previousXdg = process.env.XDG_DATA_HOME

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'oauth-safety-'))
  process.env.XDG_DATA_HOME = dir
})

afterEach(() => {
  if (previousXdg === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = previousXdg
})

const account = (email: string) => ({ type: 'oauth' as const, refresh: `r-${email}`, access: `a-${email}`, expires: 1, addedAt: 1, lastUsed: 1, email })

describe('account store safety', () => {
  test('missing store reads as null, corrupt store throws and keeps a copy', async () => {
    const file = path.join(dir, 'store.json')
    expect(await readAccountStoreJson(file)).toBeNull()
    await writeFile(file, '{"accounts": [')
    await expect(readAccountStoreJson(file)).rejects.toThrow(/refused to treat it as empty/)
    expect((await readdir(dir)).some((name) => name.startsWith('store.json.corrupt-'))).toBe(true)
  })

  test('writeJson leaves no temp files and keeps 0600', async () => {
    const file = path.join(dir, 'store.json')
    await writeJson(file, { ok: true })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ ok: true })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await readdir(dir)).toEqual(['store.json'])
  })

  test('archiveRemovedAccount appends a restorable record', async () => {
    const storePath = path.join(dir, 'opencode', 'anthropic-oauth-accounts.json')
    await archiveRemovedAccount({ storePath, provider: 'anthropic', label: '#1 a@x', reason: 'test', account: account('a@x') })
    const lines = (await readFile(removedAccountsLogPath(storePath), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({ provider: 'anthropic', reason: 'test', account: { refresh: 'r-a@x' } })
  })

  test('manual anthropic removal is archived before the account leaves the store', async () => {
    await saveAccountStore({ version: 1, activeIndex: 0, accounts: [account('a@x'), account('b@x')] })
    await removeAccount(0)
    expect((await loadAccountStore()).accounts.map((a) => a.refresh)).toEqual(['r-b@x'])
    const archived = await readFile(removedAccountsLogPath(accountsFilePath()), 'utf8')
    expect(archived).toContain('r-a@x')
    expect(archived).toContain('removed manually')
  })
})
