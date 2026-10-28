# Tailored Kimaki fork (`tailored/v1`)

Branch `tailored/v1` = upstream `remorses/kimaki` main (kimaki 1.4.0, OpenCode V2) plus a few small, isolated commits. The fork exists only to produce pull requests for upstream: generic features any Kimaki user would want, nothing kept for a single private caller. A commit leaves the fork when upstream merges it or covers it. `tailored/main` is the frozen V1-era fork and stays as the reference.

Rules for fork commits:
- One feature per commit. New code goes in its own file; upstream files get only thin hooks.
- Every fork file starts with a `// Fork:` comment that says why it exists.
- Each commit carries tests and a `.changeset/*.md` entry.
- Rebase onto new upstream releases rather than merging them in.

## Fork commits

| Commit | Feature | Fork files | Upstream files touched |
|---|---|---|---|
| `feat(voice): post long voice transcripts in full…` | Long voice transcripts are echoed in full over several messages, not cut at 1,900 chars | `echo-chunks.ts` (+test, +e2e) | `ingress.ts`, `sessions.ts` |
| `fix(commands): keep other apps' slash commands…` | Guild registration keeps commands that another app registered on the same bot (for example `/assistant`, `/whisper-*`) | `foreign-commands.ts` (+test, +e2e) | `slash-commands.ts` (`registerGuild`), digital twin GET route |
| `feat(voice): Local Whisper transcriber` | `KIMAKI_WHISPER_URL` sends voice notes to a standard `/v1/audio/transcriptions` server, keyless, local only unless `KIMAKI_WHISPER_FALLBACK=1` | `local-whisper.ts` (+test, +e2e) | `voice.ts` (transcriber list, 7 lines), `cli/bot.ts` (2 lines), test harness option |

## Inventory of `tailored/main` and old branches against upstream 1.2

| Enhancement (old ref) | Decision | Reason |
|---|---|---|
| Global events scoped before enqueue (`88a943e8`, PR #181) | Dropped, obsolete | V2 has one `/api/event` stream, routed by session id to a single thread (`event-loop.ts`). The per-thread runtime queue it fixed no longer exists. |
| Voice honours `OPENAI_BASE_URL` (`d7fb5b46`) | Dropped | Replaced by Local Whisper (`KIMAKI_WHISPER_URL`, standard `/v1/audio/transcriptions`): no global env var, no fake key, no chat-completions shim. |
| Skip project-tree context outside git or without `tree` (`022b42ed`) | Dropped, covered | 1.x runs `git ls-files` through `execFile` with a silent catch and no `tree`. |
| Compact OpenCode WARN log lines (`21065fbd`) | Dropped, obsolete | Kimaki no longer spawns OpenCode or forwards its logs; OpenCode runs as `serve --service`. |
| Keep other apps' slash commands (`a55e53ce`) | **Ported** | 1.2 still bulk-PUTs the guild list, and its "changed outside this bot" check would re-PUT and wipe the other app's commands every time it re-registered. |
| Sticky/lockable session model (`0474c39d`) | Dropped, covered in practice | V2 keeps the model on the session. `switchAgent` only switches the model when the agent itself configures one, and the owner's `opencode.json` configures none. |
| `session status --json`, `read --json`, `recover` (`0474c39d`) | Not ported (deferred) | Built on the V1 SDK. 1.x has `session list` with native status, `session read`, `/undo`/`/redo`, and the reducer shows errors. External callers can use `session list` / `session read` instead. Rebuild on V2 only if a real caller needs it. |
| Stale-question fix for status (`134152c6`) | Dropped | Depends on the dropped `session status`; V2 questions are reduced from events. |
| OAuth account archive and atomic store (`b86cbc2f`) | Dropped, obsolete | OpenCode V2 owns credentials (`kimaki login credential`); Kimaki's account-store files are gone. Still open upstream: the same refresh token used on several machines (TODO in `plugin/anthropic/index.ts`, no single-flight refresh). |
| Echo split (live dist patch `kimaki-whisper/patches/kimaki-echo-split.patch`) | **Ported** as a feature | Covers both echo sites the patch changed, plus e2e coverage. |
| `session search` (in 1.0, removed in 1.1) | Dropped | Upstream replaced it with `session sync` + rg; callers moved to that. |
| `/whisper*` commands, `whisper start/stop/status/setup`, built-in local whisper, Pro GPU tier (`feat/whisper-*` branches) | Dropped | A separate local transcription service owns `/whisper-*` and the transcription endpoint; the in-bot whisper was superseded before V2. |
| External-consumer E2E gate and naming notes (AGENTS.md / docs) | Moved to this file | Kept out of `AGENTS.md` to avoid upstream conflicts. |
| Usage analysis (`docs/analysis/*`) | Kept privately, outside git | Contains private usage data. |

## Tests

Run the suite in an isolated environment. The bot's own shell exports `KIMAKI_DATA_DIR` and `KIMAKI_LOCK_PORT`, and the global git config sets `core.autocrlf=true`. CRLF checkouts break `skills/*/SKILL.md` parsing and the worktree tests, so this repo sets `core.autocrlf=false`.

```bash
cd kimaki && env -u KIMAKI_DATA_DIR -u KIMAKI_LOCK_PORT -u KIMAKI_WHISPER_URL \
  GIT_CONFIG_GLOBAL=/tmp/test-gitconfig KIMAKI_TEST_WORKERS=3 pnpm run test --run
```

## Changes that external tools depend on

Changes to anything external scripts call or parse (CLI output, commands, voice) also need an end-to-end run of those consumers in a test channel (results are kept privately, outside git). External consumers use Kimaki's public interfaces; they are not a design constraint.
