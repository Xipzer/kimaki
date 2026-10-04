# Lens 2 — Tool traffic between Wendy and Kimaki

Read-only research. Sources:
- `~/.kimaki-whisper/diagnostics/2026-09-20..10-04.jsonl` (20,710 events; 299 `tool` events between 2026-09-22 18:46Z and 2026-10-03 12:54Z; 430 `brain` hop events, 187 brain turns, 110 of them called tools)
- Wendy source: `~/WebstormProjects/kimaki-whisper/src/wendy.ts` (tool dispatcher `executeToolInner`, lines 182-605), `src/senses/filterBlock.ts`, `src/senses/guard.ts`, `src/senses/modelPins.ts`, `src/tools/specs.ts`
- Kimaki source: `kimaki-tailored/cli/src` (HEAD `5daef11e`, release 0.31.0)
- Workspace state: `~/.kimaki-whisper/workspace/*.json`, `~/.kimaki-whisper/routes.json`, `wendy.log`
- OpenCode DB: I only inspected the schema and ran `EXPLAIN QUERY PLAN`. No data rows were read.

Method notes. "Turn" means a run of brain hops that starts at `hop:0`. I classified results as failures from the result text: `ERROR`/`BLOCKED`/`REFUSED`, `no assistant reply found`, empty strings, and the `DELIVERED ... still working` timeout fallback. Latencies are the `ms` field that `executeTool` logs.

---

## 0. Headline findings

1. **The `kimaki session read` markdown format changed upstream on 2026-09-21 (commit `3a51d493` "Compress kimaki session read markdown"). Wendy's parsers never followed.** Headers moved from `### 👤 User` / `### 🤖 Assistant` to `### user` / `### assistant (model)`. Wendy's `recentMessages()` splits on `^### (?=👤|🤖)`. On the new format that split yields one part, and the function returns `part.slice(0, 2000)`. That is the **first** 2,000 chars of the transcript (`# <title> ## Conversation ### user …`), and Wendy labels it `LIVE TRANSCRIPT … OVERRIDES anything said earlier`.
   - 86 of 110 `read_session` results (78%) are in the new format and affected.
   - `fetch_reply` returned `no assistant reply found` **10/10** times.
   - `liveTailFor` uses the same function, and so do lookup `LIVE NOW` tails, the 46 `queued_item_refreshed` rewrites, watch summaries and triggers.
   - This parse failure explains much of the repeated reading: 22 turns re-read the same session, often a second time with `chars: 30000`.
   - Root cause: Kimaki exposes transcripts only as presentation markdown, and Wendy screen-scrapes it.
2. **86% of all tool wall-time (893 s of 1,036 s) is spent waiting on Kimaki.** Every call spawns a fresh `kimaki` CLI process (DB init, OpenCode connect, logger noise that has to be stripped, 64 KB pipe truncation worked around via temp files).
3. **`search_sessions` returned empty 7/7 times.**
   - Wendy calls `kimaki session search <q>` without `--all`, so it searches only Wendy's own cwd project (`/home/xipz/WebstormProjects/kimaki-whisper`, read from `/proc/<pid>/cwd`).
   - Kimaki prints the "No matches" line through `cliLogger`, and `runKimaki` strips every logger line, so the result is `''`.
   - Kimaki already has `--all`, `--days 0` and `--json`.
4. **`ask_thread` hits its hard 12 s timeout 16/28 times (57%).** When that happens it degrades to fire-and-forget plus a watch. Successful asks took p50 8.7 s. In both cases the voice turn is blocked for 9-12 s.
5. **Wendy fully scans the 93 GB OpenCode DB every 60 s.**
   - `blockedSessions()` runs `SELECT … FROM message WHERE time_created > ? ORDER BY time_created DESC` (`wendy.ts:2118`). `EXPLAIN QUERY PLAN` gives `SCAN message` + `USE TEMP B-TREE`, because the only time index is `(session_id, time_created, id)`.
   - Per-session `threadHealth`/`filterState` queries are fine: `SEARCH … USING INDEX message_session_time_created_id_idx`.
6. **The model-pin premise is stale, and `switch_thread_model` probably only lasts one turn.**
   - `modelPins.ts` says the override "is reset by any `kimaki send` that omits `--model`". Upstream (`ensureSessionPreferencesSnapshot`, `commands/model.ts:194`) never overwrites an existing `session_models` row. Only `--agent` clears it (`thread-session-runtime.ts:3470/4545`).
   - Upstream, `send --session X --model M` applies M **to that prompt only** if the session already has a preference row. Wendy then re-sends with `--model currentModel(sid)`, which reads the old row, so the switch probably reverts on the next Wendy send.
   - The real gap: when there is *no* row, the cascade (session → agent → channel → global) can land on a different model than the one the session last ran. The `say` text "pin it straight onto 5.5 this time rather than letting it land on 5" shows this.
   - Evidence: 0 `model_pin_reasserted` events, and `model-pins.json` is `[]`.
7. **Kimaki already ships pieces Wendy re-implements.**
   - Wendy finds OpenCode servers by parsing `ss -ltnpH`. Kimaki has `GET /kimaki/opencode-port` (hrana-server.ts:184) and runs a **single** OpenCode server.
   - Wendy polls transcripts every 45 s. Kimaki holds one `/global/event` SSE connection (`session-handler/global-event-listener.ts`).
   - Wendy refreshes its index with 1 + 44 per-project CLI calls (~100-120 s per walk, every 10 min, from `wendy.log`). `kimaki session list --all --json` does the same in one call and already returns `status`, `model`, `tokens` and `threadId`.

---

## 1. Per-tool statistics (299 calls)

| Tool | n | p50 ms | p90 ms | max ms | Failure / empty | Typical args |
|---|---|---|---|---|---|---|
| read_session | 110 | 1,816 | 6,597 | 15,936 | 1 ERROR. **86 wrong-content** (new-format → oldest 2 KB returned). 46 `unverified` (id not from a lookup this turn, 42%). 11 prefixed `STUCK ON CONTENT FILTER` | `{session_id}` (80), `{session_id, chars:30000}` (30) |
| ↳ default / deep | 80 / 30 | 1,969 / 1,674 | 7,340 / 6,520 | 15,936 / 8,689 | | |
| lookup_thread | 34 | 8 | 3,009 | 16,595 | 0 empty. Index-only hits p50 3 ms. With live tails (16) p50 1,788, p90 10,975 | `{query:"RPC Usage Watch BaseStonk"}` |
| ask_thread | 28 | 12,012 | 12,019 | 12,026 | **16 timeouts (57%)** at the 12 s cap. 12 replies (p50 8,670) | `{session_id, prompt}` (long briefs) |
| thread_health | 22 | 2 | 5 | 6 | 0 (direct SQLite) | `{session_id}` |
| say | 12 | 4,460 | 9,190 | 10,118 | 0 (TTS, not Kimaki) | `{text}` |
| bash | 11 | 4 | 30,004 | 45,005 | 2 empty. Used for `grep`/`find`/`cat` across repos | `{command[, timeout_sec]}` |
| fetch_reply | 10 | 6,244 | 6,661 | 6,661 | **10/10 "no assistant reply found"** (format change) | `{session_id}` |
| spawn_agent | 8 | 3,563 | 12,497 | 12,497 | 0 | `{goal, label, model:"opus"/"local"}` |
| send_to_session | 8 | 3,520 | 9,085 | 9,085 | 0. Result leaks raw CLI box-drawing (`4144346/1543… │`) | `{session_id, prompt}` |
| search_sessions | 7 | 2,136 | 6,236 | 6,236 | **7/7 empty** (cwd scope + logger stripping) | `{query:"Sky Broadband"}` |
| spawns_status | 6 | 1 | 2 | 2 | 0. Local ledger shows stale entries 38,835 min old | `{}` |
| list_recent_sessions | 6 | 1,077 | 6,214 | 6,214 | 0 | `{directory:"basestonk"}` |
| telegram_chat / _search / _members | 5/4/1 | ≤21 | ≤24 | 24 | 0 (not Kimaki) | |
| index_pulse | 4 | 0 | 2 | 2 | 0 | `{}` |
| index_stats | 3 | 0 | 0 | 0 | **3/3** "unknown projects (loaded from disk, refresh pending)" | `{}` |
| dispatch_task | 3 | 2,511 | 4,059 | 4,059 | 0 | `{channel_id, prompt}` |
| switch_thread_model | 3 | 2,738 | 8,598 | 8,598 | 0 reported, but the switch is likely one-turn (see §0.6). Flapped local↔fable↔local on one thread | `{session_id, model}` |
| schedule_check | 3 | 0 | 0 | 0 | 0 | `{session_id, minutes, note}` |
| recall | 3 | 0 | 1 | 1 | 0 | `{query}` |
| watch_thread, snooze_updates, read_note, guard_thread, list_projects | 2,2,2,1,1 | ≤7 (list_projects 4,853) | | | 0 | |

Background Kimaki traffic that is not in `tool` events:
- **Index walk:** 45 CLI processes every 10 min, ~6,500 per day.
- **Watchlist polls:** a full `session read` (up to 500 KB) every 45 s per watched session. There were 101 `watch_delta` and 23 `watch_done` events.
- **`kimaki session wait`:** 86 finish watches armed, but only 14 fired. 35 had to be re-armed because of the 30 min cap in `wait-session.ts:61`, 6 died and 9 were ignored as instant false finishes.
- **Guard ticks:** `threadHealth` every 20 s per guarded thread, plus `listMessages` via the OpenCode HTTP API. 51 unblock attempts led to 34 recoveries.
- **`blockedSessions`:** a full DB scan every 60 s, with 10 detections.
- **`sqlite3` subprocess per send:** a shell-out to read `session_models` (`currentModel`).

## 2. Repeated chains

Per-turn tool sequences (110 turns with tools). Categories overlap.

| Pattern | Turns | Calls | Tool time | What it is | Single replacement |
|---|---|---|---|---|---|
| **Status probe**: read_session + thread_health and/or fetch_reply (e.g. `read_session > fetch_reply > thread_health > read_session`) | 24 | 101 | 372 s (15.5 s/turn) | "What's that thread doing / what did it say last?" | `kimaki session status <id> --json` → `{status, model, contextTokens, lastActivityAt, lastError, blockedBy, lastAssistantText}` |
| **Repeat read of the same session in one turn** | 22 | 96 | 403 s | Default read returned the wrong (oldest) 2 KB, so the model re-reads with `chars` | `kimaki session read <id> --json --last N` (structured messages, newest-first) |
| **Read → message** (`read_session > ask_thread/send_to_session`) | 18 | 78 | 370 s | Check state, then instruct | `status --json` + non-blocking `send --json` |
| **Resolve → message** (`lookup_thread > ask_thread/send`) | 19 | 74 | 360 s (19 s/turn) | Name → session → prompt. 9 direct `lookup→ask` bigrams | Wendy composite `message_thread(query, prompt)`. Kimaki side: `send --session` returns `{messageId}` immediately, and `session wait --after <messageId>` |
| **Resolve → read** (`lookup_thread > read_session`) | 12 | 63 | 236 s | Name → transcript | Wendy: return the structured tail with the lookup hit, using `session list --all --json` + `read --json --last 1` |
| **Deep-search fallback** (`lookup > search_sessions > list_recent_sessions > …`, up to 8 calls) | 5 | 31 | 103 s | Index miss, then search (empty), then list | Fix: `session search <q> --all --days 0 --json`. Better: a Kimaki title/nickname search over `thread_sessions` |
| Single-call `read_session` turns | 27 | 27 | — | Background-update follow-ups | Push the delta with the update (event stream) so no read is needed |

Bigram counts: `read_session→read_session` 24, `thread_health→read_session` 12, `read_session→ask_thread` 10, `lookup_thread→ask_thread` 9, `read_session→thread_health` 8, `read_session→fetch_reply` 7.

## 3. How each Kimaki-facing tool is implemented, and the API that should exist

| Wendy tool / subsystem | Implementation (file:line) | Workaround for a missing Kimaki API? | API that should exist | Upstream status (kimaki-tailored) |
|---|---|---|---|---|
| `runKimaki` (all CLI tools) | Spawns `bash -c 'exec kimaki … > tmp 2> tmp.err'`, reads the file, strips lines matching `^[│■]\s+HH:MM` and turns `■ … CLI …` into ERROR (wendy.ts:108-143) | **Yes.** It works around 64 KB stdout truncation, logger output mixed into stdout, and the lack of exit-code/JSON error contracts | A machine mode: `--json` on every command, logs only to stderr, a JSON error envelope, exit codes. Ideally a local HTTP/IPC API on the existing hrana server | Partial: `--json` exists on `project list`, `session list`, `session search`, `session editors`, `session discord-url`. Not on `read`, `wait`, `send`. Logger still writes to stdout |
| `read_session`, `fetch_reply`, `liveTailFor`, watch polls, triggers | `kimaki session read <id>` (no `--project`), reads up to 500 KB from the end, regex-splits markdown on emoji headers (wendy.ts:146-168, 278-293, 332-345, 936-942, 1669-1710) | **Yes.** It scrapes presentation markdown, which broke silently on 09-21. With no `--project`, the CLI tries cwd first and then walks every project (session.ts:452-487), which explains the 16 s max | `kimaki session read <id> --json [--last N] [--since <msgId>] [--role assistant]` → `[{id, role, model, time, text, tools:[…], error}]`. Plus `--project` auto-resolved from `thread_sessions`/OpenCode `session.directory` | Missing. Only markdown, `--verbose`, `--thinking`. `session export-events-jsonl` dumps Kimaki's persisted event buffer but is a debug tool |
| `thread_health`, `filterState`, `blockedSessions`, guard `sessionDir` | `node:sqlite` read-only on `~/.local/share/opencode/opencode.db`. Parses `message.data` JSON for `error.name == ContentFilterError`, `MessageAbortedError`, `time.completed`, `tokens` (filterBlock.ts) | **Yes.** The markdown omits message-level errors (markdown.ts only renders `tool-error`), and Kimaki has no status command. Also couples Wendy to OpenCode's private schema. The `blockedSessions` scan costs a 93 GB table scan per minute | `kimaki session status <id> --json` and `kimaki session list --all --active --json --blocked`, with `lastError {name,message,at}`, `awaitingReply`, `lastOkAt`, `contextTokens`. Plus an event (`session.error` with `ContentFilterError`) on a stream | Partial: `session list --json` has `status` (idle/busy/showing-question), `model`, `tokens`. Kimaki handles `session.error` in the runtime (thread-session-runtime.ts:1712/1780, posts `✗ opencode session error` to Discord) but exposes it nowhere for machines. No content-filter detection anywhere (`grep ContentFilter` → only the transcription filter) |
| `lookup_thread` + thread index | Every 10 min: `project list --json` then `session list --project <dir> --json` for each of 44 projects. Fuzzy title/dir/nickname match in memory. `extractJsonArray` digs JSON out of log-polluted output (wendy.ts:997-1123) | **Mostly.** One call would do. Live tails via `session read` are bounded to 3 s | `kimaki session list --all --json --since <ts>` (incremental), with `nickname`/`aliases`, Discord guild/channel names and the thread URL inline | **Exists:** `session list --all --json` (session.ts:124). Wendy doesn't use it. Missing: `--since`, Discord location names, aliases |
| `search_sessions` | `kimaki session search <q>` (wendy.ts:252) | No. It's a Wendy bug: missing `--all`/`--json` | Use `--all --days 0 --json --limit 10` | **Exists** |
| `list_recent_sessions` | `session list --project <dir> --json` | No | — | Exists |
| `ask_thread` | `send --session X --model <current> --prompt … --wait` with a 12 s kill. On timeout it returns "DELIVERED" and arms a watch (wendy.ts:254-268) | **Yes.** `--wait` has no non-blocking or "return message id" mode, so Wendy has to kill and re-poll | `send … --json` → `{sessionId, threadId, messageId, queued}` immediately, plus `kimaki session wait <id> --after <messageId> --timeout <s> --json` → `{status, reply}`. Even better: a reply event on a stream | Missing. `--wait` blocks until completion (30 min cap) and prints the whole transcript |
| `send_to_session`, `dispatch_task`, `spawn_agent` | `kimaki send …`. New id regex-scraped from output (`/ses_[a-zA-Z0-9]+/`). Then `ledgerAdd` + `watchSession` + an index refresh after 60 s (wendy.ts:188-205, 269-277, 346-375) | **Partly.** It scrapes the id. The ledger/watch duplicates bot state | `send --json` → `{sessionId, threadId, threadUrl}`. Kimaki-side "started-by" metadata (it already has `startedBy`/`scheduledTaskId` for cron) extended to `startedBy: cli:<label>` | Partial: `startedBy` exists for scheduled tasks only. No `--json` on send |
| Finish detection (`armFinishWatch`) | `kimaki session wait <id>` per watched session, delayed 12 s. Re-armed after the 30 min cap. Exits under 8 s are ignored as false "finished" on idle sessions (wendy.ts:1590-1659) | **Yes.** It needs one blocked process per watch, and `wait` returns instantly when the prompt hasn't started yet | Event stream `kimaki events --json` (NDJSON) or SSE on the hrana server: `turn.started/finished/errored/blocked/question` with `sessionId, threadId, messageId`. Or `wait --after <messageId> --timeout` | Partial: Kimaki has one `/global/event` SSE connection to OpenCode internally and persists `session_events` (schema.ts:52) but does not re-publish them. Wendy *could* subscribe to OpenCode `/global/event` directly via `/kimaki/opencode-port` |
| `thread_model_pin`, `modelPins.sweep`, `currentModel`, `sendKeepModel` | `execFileSync('sqlite3', ['~/.kimaki/discord-sessions.db', …])`. **Writes** `INSERT … ON CONFLICT` into Kimaki's `session_models` and sweeps every 15 s (modelPins.ts). Every send passes `--model <row>` | **Yes, and dangerous**: it writes into another process's DB from a shell, uses string-escaped SQL and skips the `variant` column. The premise (sends without `--model` reset the row) does not match current upstream code | `kimaki session model <id> [<provider/model>] [--variant] [--lock] [--json]`. Get/set/lock a per-session model, and record the actually-used model as the session pref on first run so the cascade can't drift | Missing from the CLI. Exists only as Discord `/model` (commands/model.ts) and `/unset-model`. No lock concept |
| `switch_thread_model` | `send --session X --model M --prompt "(Wendy switched…)"` (wendy.ts:421-443) | **Yes.** There is no set-model API | Same `session model` command. A one-shot `--model` should be documented as per-prompt | **Upstream semantics: per-prompt** when a session pref exists (`ensureSessionPreferencesSnapshot` returns early). The switch probably doesn't stick |
| `recover_thread`, `guard_thread`, Guards | Health from SQLite. Messages via the OpenCode HTTP API. Server found with `ss -ltnpH` (`opencodeBase`). `POST /session/:id/revert`. Restores partial files with git. Resends briefs via `kimaki send` (filterBlock.ts:130-161, guard.ts) | **Mostly.** Server discovery and health are workarounds. Revert/brief policy is Wendy logic | `GET /kimaki/opencode-port` (exists) instead of `ss`. Kimaki-native `session revert <id> --to <messageId>` and `session status`. Possibly a Kimaki-level "auto-resume on transient error" (Kimaki already shows retries) | `/kimaki/opencode-port` **exists** (hrana-server.ts:184). Single OpenCode server (opencode.ts:1) makes per-session discovery unnecessary. `/undo` exists in Discord only |
| `nickname_thread`, routes (`routes.json`), `save_route` | Local JSON maps from names to session/channel id | **Partly.** Kimaki has titles (`session title`) but no aliases | `kimaki session alias <id> <name>` stored in Kimaki, so search/list/send accept the alias | Missing (`session title` exists and renames the thread) |
| `watch_thread`, triggers, `schedule_check`, commitments | Local timers + polling | Partly. Scheduling could use `send --send-at`/`task` | `kimaki send --send-at` covers delayed prompts. Content triggers depend on the event stream | `--send-at`, `task list/delete` exist |
| `list_projects` | `project list --json` | No | — | Exists |
| `index_stats` | In-memory counter | Wendy bug: `indexProjectCount` is 0 when loaded from disk, so 3/3 calls gave a useless answer | — | — |

## 4. Top 10 opportunities

| # | Opportunity | Tag | Effort | PR fit | Evidence / payoff |
|---|---|---|---|---|---|
| 1 | **Structured transcript API:** `kimaki session read <id> --json [--last N] [--since <msgId>]` with role, model, time, text, tool summaries and **message-level error**. Auto-resolve the project from the session id instead of trying cwd and walking all projects | Kimaki-native | M | **Upstream PR**. General automation value. The 09-21 markdown compression shows that markdown is not a contract | Affects 110 read_session + 10 fetch_reply + all background tails. Removes the wrong-content bug (86 reads, 46 refreshes) and the 16 s project walk |
| 2 | **Fix Wendy's parsers now:** split on `^### (user\|assistant)`, take the tail not `slice(0,2000)`, and repair `fetch_reply` | Wendy | S | — | Restores read_session, fetch_reply, liveTailFor, watch summaries and triggers today. Should cut most of the 22 repeat-read turns (96 calls, 403 s) |
| 3 | **`kimaki session status <id> --json`** (and `list --active --json` with `lastError`, `blocked`, `awaitingReply`, `lastAssistantExcerpt`) | Kimaki-native | M | **Upstream PR** (natural extension of `session list` status) | Replaces `thread_health`'s direct reads of OpenCode's private DB and the 24 status-probe turns (101 calls, 372 s). Removes the 60 s full scan of the 93 GB DB |
| 4 | **Event stream:** `kimaki events --json` (NDJSON) or authenticated SSE on the hrana server, re-publishing `turn.finished/errored/question` and `session.error` (incl. ContentFilterError) | Kimaki-native | L | Upstream PR (pitch as "automation hooks"). Fork first if maintainers resist | Replaces 45 s polling, `session wait` processes (35 re-arms, 9 false finishes, 6 dead), the `blockedSessions` scan, and ask_thread's 12 s blocking |
| 5 | **Non-blocking send:** `send --json` → `{sessionId, threadId, messageId}`, and `session wait --after <messageId> --timeout N --json` | Kimaki-native | S-M | **Upstream PR** | ask_thread 57% timeouts at 12 s. Id scraping in dispatch/spawn/send. CLI box-drawing leaking into results |
| 6 | **Per-session model get/set/lock CLI:** `kimaki session model <id> [model] [--variant] [--lock]`. Snapshot the actually-used model on first prompt | Kimaki-native | M | Upstream PR for get/set. `--lock` maybe fork-only | Stops Wendy writing `discord-sessions.db` with `sqlite3`. Fixes `switch_thread_model` being per-prompt. Removes the 15 s pin sweep and per-send `sqlite3` shell-outs |
| 7 | **Use what exists:** `session list --all --json` for the index (1 call instead of 45, ~100-120 s per walk), `session search --all --days 0 --json`, `/kimaki/opencode-port` instead of `ss -ltnpH` | Wendy | S | — | search_sessions 7/7 empty → working. Index walk ~100 s → ~1 call. Guard server discovery becomes deterministic |
| 8 | **Machine-clean CLI output:** logger to stderr when stdout is not a TTY or `--json` is set, a JSON error envelope, and a fix for the >64 KB piped stdout truncation (flush before `process.exit`) | Kimaki-native | S | **Upstream PR** (bug-class) | Removes Wendy's temp-file workaround, `extractJsonArray` and the logger-line regexes. The stripping regex also hid search's "No matches" |
| 9 | **Session aliases + resolve:** `kimaki session alias`, and `kimaki session resolve "<query or nickname or thread url>" --json` returning the ranked sessions with Discord location | both | M | Upstream for resolve. Aliases may be fork-only | 19 resolve→message + 12 resolve→read turns. 46 unverified reads (42%) and 10 `unverified_target_blocked` where Wendy used a remembered id |
| 10 | **Wendy composite tools on top of 1/3/5:** `thread_brief(query)` = resolve + status + last reply in one call. `message_thread(query, prompt, wait≤N)`. Plus index-based OpenCode queries only (drop `blockedSessions` until #3/#4 land, or bound it with `session_id IN (active ids)`) | Wendy | S-M | — | Collapses the chains in §2. The interim DB fix removes the 1,440 full scans per day of the 93 GB table immediately |

### Suggested sequencing
1. Wendy-only quick wins (#2, #7, interim part of #10). These are hours of work and fix the measurable failures: fetch_reply 0%, search 0%, read wrong-content 78%.
2. Small upstream PRs: #8 (output hygiene), #5 (`send --json` / `wait --after`), then #1 (`read --json`).
3. Medium: #3 (`session status --json`), #6 (`session model`).
4. Large: #4 (event stream). After it, Wendy's watchers, finish waits, guards' health polling and model-pin sweeps become subscribers.

## Appendix — key evidence pointers
- New markdown headers: `cli/src/markdown.ts:278` (`### user`) and `:328` (`### assistant (${modelId})`), introduced in `3a51d493` (2026-09-21). Wendy's split: `wendy.ts:148`. Wrong-slice fallback: `wendy.ts:167`.
- Sample default `read_session` result (2026-10-01): `### # V7 launcher: anti-flash rewards\n\n## Conversation\n\n### user\n\nPrompt attached as file…`. That is the session's opening message, presented as live state.
- `session search` scope default = cwd: `cli-commands/session.ts:612-622`. Wendy's cwd = `kimaki-whisper` (`/proc/<pid>/cwd`).
- `session read` project walk: `session.ts:452-487`.
- `send --model` on an existing session is per-prompt when a pref row exists: `commands/model.ts:213-236`. The row is cleared only with `--agent`: `thread-session-runtime.ts:3468-3471, 4543-4546`.
- `/kimaki/opencode-port`: `hrana-server.ts:184`. Single OpenCode server: `opencode.ts:1, 374`. Internal SSE: `session-handler/global-event-listener.ts:2`.
- `kimaki session wait` 30 min cap: `wait-session.ts:61`.
- OpenCode DB plans: `SCAN message` + temp B-tree for the time-window query. `SEARCH … USING INDEX message_session_time_created_id_idx` for per-session queries.
- Workspace state at time of reading: `guards.json` `{}`, `model-pins.json` `[]`, `schedules.json` `[]`, `nicknames.json` has 1 entry. `routes.json` maps names to session/channel ids, a stand-in for Kimaki aliases. `dispatch-status.json` is the ledger that duplicates the bot's started-by data.
