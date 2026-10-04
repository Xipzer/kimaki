# Lens 4: friction log from the "Wendy builder" thread

Research only. Sources:

- Builder session transcript `/tmp/opencode/builder-thread.md`: 32,642 lines, 577 user turns, about 3,065 assistant messages and 2,617 tool calls. About 66.7 h of summed `duration:` lines. That figure includes permission waits and sleeps, so treat it as an upper bound.
- `git log` of `~/WebstormProjects/kimaki-whisper` (the Wendy repo): 57 commits in the last 30 days and 242 in the last 60.
- `~/bin/kimaki-prereqs`.
- Spot checks of `kimaki-tailored/cli/src` (v0.31.0) to see whether each Kimaki bug is still present.

**Time span.** The thread covers more than the last ~2 weeks. I mapped commit hashes cited in the transcript to their git dates:

| Transcript lines | Dates | Era |
|---|---|---|
| L0–9000 | ~Jul 1 – Aug 21 | Whisper fork, PR and sidecar |
| L9000–27800 | Aug 22 – Sep 19 | Wendy (first called JARVIS) built and hardened |
| L27800–32640 | Sep 20 – Oct 4 | Last ~2 weeks: voice V2 rebuild, travel, autonomy, content-filter guard |

All three eras are included. Each incident row gives its line position (`L…`) and date.

**Caveats.**

- Tool outputs in the dump are collapsed to one line ("tool: bash … (N lines)"). Root causes come from the assistant's own write-ups, cross-checked against commits and current source where possible.
- Recurrence counts are lower bounds. They count distinct times the owner hit or reported the issue.
- The dump contains secrets (bot tokens, a Telegram key) and some offensive chat-group names. This report deliberately repeats none of them.

---

## 1. Incident log

Classes:

- **KB** = Kimaki bug
- **MC** = missing Kimaki capability
- **WG** = Wendy gap
- **IN** = infra (GPU, services, network, OS, provider)

"Cost" is a rough count of the user turns and tool calls spent on the incident.

### 1a. Kimaki bugs (KB)

| ID | Symptom | Root cause | Fix / workaround | Where / when | Recurrence | Still in 0.31 source? |
|---|---|---|---|---|---|---|
| KB1 | Threads "brick": typing indicator stuck and unrelated threads stall. Every restart wedged again within 30 s once many threads were busy. | Global SSE listener calls `dispatchAction()` for **every** event into **every** thread runtime. The session filter runs only later, in `handleEvent`. Work scales as events × runtimes. Introduced by `14f6c934` (Jun 5, single global event stream). | Fix written with 4 tests, filed upstream as issue #180 and PR #181. Lost again when the fork was abandoned; the owner was "re-exposed daily" on published builds. | L7268–7630, ~Jul 25 | Chronic. Every restart under load. | **Yes.** `thread-session-runtime.ts:990-995` dispatches before the filter at ~L1743. |
| KB2 | Fork bot dies at startup with `ERR_MODULE_NOT_FOUND analytics.js`. Several independent agents reported "the fork has missing modules". | Upstream `main` imported `../analytics.js` but `analytics.ts` was never committed. | Local stub, then issue #183. Fixed upstream in 0.25.0. | L6970–7900 | 1 bug, about 4 reports from different agents | No (fixed upstream) |
| KB3 | Wendy reports thread status that is **weeks old**: "she's super behind". | `kimaki session read` piped to another process truncates at ~64 KB. The CLI calls `process.exit()` right after `process.stdout.write(result)`, before the pipe drains. Readers got the **oldest** part of multi-MB transcripts (the nutrition thread is 293 MB). | Wendy's `runKimaki` now redirects output to a temp file and reads from the end (500 KB budget). Commits `fb5d0ac`, `7f18fa1`. The builder flagged "worth an upstream issue"; none was filed. | L10842–11140, ~Aug 23 | 3 owner complaints, plus 2 more (L11673/11692) caused partly by it | **Yes.** `cli-commands/session.ts:448-449, 484-485` |
| KB4 | Voice notes fail with 401 `Incorrect API key` against api.openai.com, even though `OPENAI_BASE_URL` is set. | Kimaki ≥0.30 hardcodes the transcription URL. In 0.30.1 the `OPENAI_CHAT_COMPLETIONS_URL` constant is fixed; in 0.31.0 the `OPENAI_BASE_URL` constant is fixed. The env var is ignored. | `~/bin/kimaki-prereqs` pre-fetches `kimaki@latest` and **regex-patches `dist/voice.js` in the npx cache on every launch**. It warns if the file's shape changes. Commits `4f5bc64` (Sep 27) and `e53f701` (Oct 2). | L30320–30370, L31956–32041 | 2 regressions in 5 days, plus 2 automated "[auto] … voice.js patched=1" restart check-ins | **Yes.** `voice.ts:32` `const OPENAI_BASE_URL = 'https://api.openai.com/v1'` |
| KB5 | `/wendy`, `/whisper-*` and the other 14 commands disappear from all guilds. | Kimaki registers guild commands with a bulk `PUT`, which deletes every command not in its own list. Wendy and the sidecar share the bot token, so they share one command set per guild. | Wendy only ever POSTs one command at a time. She re-asserts every 6 h, checks for wipes every 10 min via GET, and has a `!wendy-commands` text fallback (`b8134e5`). OPERATIONS.md has a "slash commands vanished" runbook row. | L6412 (July sidecar design), L23884–23999 (~Sep 4) | ≥2 visible wipes, recurs on every Kimaki restart or upgrade | **Yes.** `discord-command-registration.ts:633` `rest.put(...)` |
| KB6 | Per-thread model overrides keep reverting, e.g. threads set to fable-5-1 fall back to the default. | Per transcript: any `kimaki send` without `--model` resets the thread's `session_models` row. That covers thread-to-thread messages and Wendy's own sends. | Wendy always passes `--model` and added "model pins": direct SQL writes to `~/.kimaki/discord-sessions.db` with a 15 s re-assert sweep (`modelPins.ts`). A wrong alias then caused a pin war (WG18). Pins are now dormant. | L23142–23300, L23595–23880, ~Sep 3–4 | Chronic. The owner raised it at least 6 times, including the ALL-CAPS turns 414–421. | Not re-verified (reported by the builder from source at the time) |
| KB7 | `kimaki project add` / channel creation puts the new channel in the **wrong Discord server**. | Picks a default guild in a multi-guild install; there is no guild argument. | Manual cleanup and respawn. Wendy's channel needed a "guild flag". | L15002 (~Aug 26), L30793–30837 (~Sep 29) | 2 | Not checked |
| KB8 | Launching Kimaki from a shell spawned by Kimaki or OpenCode misbehaves. | Child-process detection and IPC use inherited env vars (`KIMAKI*`, `OPENCODE*`). | The owner's launcher strips 15 variables with `env -u …`. Kimaki is launched from JetBrains Gateway via tuistory. | L27055–27098 | Persistent (launch recipe) | Not checked |

### 1b. Missing Kimaki capabilities (MC)

| ID | Gap | Evidence and cost | Workaround in use |
|---|---|---|---|
| MC1 | **No plugin hooks.** There is no way to register slash commands, pre-process incoming messages or attachments (voice notes, reply "retranscribe"), or run lifecycle hooks. | Fork plus PRs #158/#167 (~28 user turns, ~174 tool calls on fork upkeep). The owner gave up: "too annoying having to continuously catch up". The maintainer agreed to add hooks after the OpenCode v2 migration. | A **second gateway connection on Kimaki's bot token**. The token is read from `~/.kimaki/discord-sessions.db` `bot_tokens` (`src/token.ts`). Retranscriptions are injected with `kimaki send --thread`. |
| MC2 | **Transcription endpoint is only set through the env var.** Kimaki has no dependency or health check on it. | 3 recurring failure modes (`ECONNREFUSED :7070`, `Incorrect API key`, `backend unreachable`). A non-login Gateway shell never sees `OPENAI_BASE_URL`. The owner asked twice to "bundle the whisper launch into the kimaki launch" (turns 22, 478). | `kimaki-prereqs` health-gates speaches, kyutai and Wendy, then `exec env OPENAI_API_KEY=local OPENAI_BASE_URL=… npx -y kimaki@latest`. |
| MC3 | **Transcription failure is silent or misleading.** With a dead backend, the note arrives as `[inaudible audio]` ("the voice is extremely clear"). `/whisper-status` reported healthy while the backend behind the shim was dead. | L4049–4120, L5156 | A deeper health probe was noted but never built in Kimaki. |
| MC4 | **No thread health or state API.** A content-filter block is invisible: `session read` omits the error, so the transcript just stops mid-word. | Content-filter saga, ~11 user turns, ~83 tool calls and about 10 Wendy commits (Oct 1–3). | `filterBlock.ts` opens **OpenCode's `~/.local/share/opencode/opencode.db` read-only** and looks for `ContentFilterError`. It also builds its own `thread_health` (blocked / errored / working / waiting / idle). |
| MC5 | **No recovery primitive** (revert the failed turn, resend on the same model). | The guard looped ~30 recoveries in 23 min with identical briefs. One revert wiped ~30 min of good work (`StaleSharesFork.t.sol`). It raced a manual fix. Nine defects were found in one live run (`39b2f47`). | Raw OpenCode HTTP calls: `GET /session/{id}/message` and `POST /session/{id}/revert`, after **probing every local opencode server for the one that owns the session**. Partially written files are restored with git. |
| MC6 | **No event stream or notification for external consumers** (assistant reply finished, session idle, errored). | The watcher set its baseline *after* the reply had already arrived, so replies were never passed back (L11546). Repeated and stale updates (WG12). The owner asked many times for her to come back on her own when a thread finishes. | Wendy polls `kimaki session read` every 45 s. Her index walk runs `project list` and `session list` per project across ~1,200–1,360 sessions (`wendy.ts:1023-1047`). Reads are cached 45 s and bounded to 2.5–3 s. |
| MC7 | **No per-thread model lock.** | See KB6. | DB writes and a sweep (dormant). |
| MC8 | **No way for a plugin to claim a voice channel.** Mapping Wendy's voice channel arms Kimaki's hardcoded Gemini realtime worker on the same token, which allows one voice connection per guild. | L9668–9709 | The voice channel is deliberately left unmapped. `[IGNORED] no directory configured` log spam is tolerated. |
| MC9 | **No message claim or ignore for co-tenants.** Both Kimaki's agent and the sidecar gateway answered "retranscribe" (L26820). | L26807–26890 | The standby node posts plain text through its own token. |
| MC10 | **No safe self-restart from inside a thread.** `/upgrade-and-restart` exists but would skip the prereqs patch, and restarting kills the builder's own session. | L30362: "I can't restart it from inside this thread without killing this session." | **The projector restarts the printer's Kimaki remotely** and posts "[auto] Printer Kimaki restarted … voice.js patched=1. Verify…" (L32017, L32475). |
| MC11 | **Permission prompts time out and the turn is lost.** | 5 "Permission timed out" and 6 rejected-permission tool errors. Owner turns were wasted ("grant and say go"). | Owner re-prompts manually. |
| MC12 | **No multi-identity or foreign-guild story.** One token means one live Wendy, so standby nodes cannot co-exist (L25235). | Multi-node design (~58 turns) worked around it with token-per-node and active/standby handover. | `wendy-node.sh` promote/demote. Standby nodes use their own Kimaki token for "retranscribe" only. |

### 1c. Wendy gaps (WG)

Grouped. Each line is one distinct incident or bug class.

| ID | Symptom | Root cause | Fix (commit) | When | Recur. |
|---|---|---|---|---|---|
| WG1 | "Reasoning engine error" right after restarts | Ghost or duplicate processes held :7071 and the gateway, so restarts silently lost the race | Atomic detached restart script, build marker | L9465–9570, Aug 22 | 3 |
| WG2 | "Reasoning engine error" mid-tool call | `max_tokens` truncated tool-call JSON, then llama.cpp returned 500 (300 → 1200 → 4000), plus JSON repair | `5eb1338` and earlier | L9401, L10135, L14632 | 3 |
| WG3 | Brain 500s after streaming upgrade | SSE assembler omitted `type:"function"`; lone surrogates; consecutive assistant messages rejected by the new llama.cpp (conversation path fixed, worker path missed) | `de72aca`, `32688db`, `f67e9d6` | L13675, L21411 | 4 |
| WG4 | "Dumber than usual", 30 s stall after every reply, cache misses | History bloated 21k → 44k tokens of repeated boilerplate; `repairHistory` mutated live history; the aux YES/NO check was queued behind the background lane | `af918c4`, `50e2c43`, `13f9881`, `74fc75c` | L29637, L29684, L30899 | 3 |
| WG5 | "Not dead, deaf" | Capture latch stuck `true` (stream closed without `end`; empty-capture early return) | `10c3af0`, `45574cb` | L12637, L22677 | 2 |
| WG6 | Deaf after reconnect or STT restart | Audio subscription bound to a dead stream; re-subscribing in the same tick returned the destroyed stream | `6b37003`, `f578a16` | L29815, L30989 | 2 |
| WG7 | Replies to ambient noise | Whisper silence hallucinations; adaptive energy gate fed back on itself | `733e79e` plus gates; L16065 fix | L12458, L12595, L16065 | 3 |
| WG8 | Turn-taking: cut-outs, talking over the owner, dropped short replies, double greeting, 60 s cut-off | Phantom barge-in; end-of-turn firing on pauses; 0.5 s length gate; Discord re-firing the join; capture ceiling | `f3af8ce`, `cde20f7`, `8fdc8a3`, `e27611a`, `10243ff`, `7581470`, `e7085ac` … | L13264–L31425 | ≥9 |
| WG9 | Mute/unmute, name-only mode broken | Wake check ran after the confidence gates; name-only setting persisted past the group call | L13124, L28130 fixes | L11460, L13093, L23310, L23416, L28130 | 5 |
| WG10 | Stale or out-of-date thread status | Partly KB3; then char-tail vs message-aware reads, recency selection, freshness override | `df58642`, `9c188c8` | L10842–11140, L22947, L23000 | 5 |
| WG11 | Never passes back replies; repeats updates; stale queued updates | Watcher baseline race; no reported-up-to watermark; queued text generated at fire time | L11546, L12045, L14724, L18251 fixes | Aug 23–28 | 5 |
| WG12 | Dispatches to the wrong thread | `ses_` ids recalled from memory or routes instead of a fresh lookup | Id-discipline rule, "must have just looked up" guard | L11673, L11789, L21732 | 3 |
| WG13 | Claims "sent it" but didn't; later an exact duplicate send | The model hallucinated the send; the claim guard's per-turn ledger then *ordered* a duplicate | `a86a7fd`, `4f4b2b2` (cross-turn ledger plus 10-min dedupe) | L18822–19051, L23451 | 3 |
| WG14 | Says she'll do something, then idles (GPU at 0%) | No promise ledger or away loop | Promise ledger and away duty (`39dec70`, `aa33228`, `b562baf`) | L10539, L14201, L15923, L21651–21679 | 4+ |
| WG15 | `/wendy` controls lie or don't work | Stop derived from wake by regex (it re-armed the wake flag); dormant flag loaded on boot; fire-and-forget status; stop didn't free VRAM | `a4edfdb`, `0b07da7`, L17849, `6a32af0` | L13710, L17688, L17849, L19053, L24190 | 5 |
| WG16 | Voice join flicker or stall in "signalling" | Ghost voice session left by a hard kill; single 15 s attempt | `8e3b173`, `1a22ac7` | L22859, L24439 | 2 |
| WG17 | Model pin war (owner furious) | Pin alias `fable → claude-fable-5` was stale, so the sweep enforced the wrong model; restarts raced the sweep | Alias fix, then pins removed | L23595–23880, Sep 3–4 | 1 (very high cost) |
| WG18 | Content-filter guard misbehaves | Resent identical briefs (~30 in 23 min); attempt counter reset on first token; overlapping recoveries; changed models or output format; invented paths; reverted good work | `f7e460b` → `258f5ec` → `e12c5ba` → `b83792f` → `d415618` → `39b2f47` → `2a66738` | L31442–32340, Oct 1–3 | 3 live failures |
| WG19 | Hallucinated role or self-reference in summaries | Summariser obeyed a quoted cron prompt; self-updates written in third person | `703a56f`, identity anchor | L16189, L17860, L29270 | 3 |
| WG20 | The builder's own operations disrupted live Wendy | Restarts killed in-flight replies; smoke tests wrote into her `history.json`; STT probe or stress test kicked her off | Drain-on-restart (45 s + 15 s), test isolation (`WENDY_TEST`) | L11759, L23805, L29958 | 4 |
| WG21 | Two Wendys on one token; handover broke the printer's transcription | Standby left as a full Wendy; :7070 moved with her | serve-only standby, `wendy-node.sh` | L26249, L26603 | 2 |
| WG22 | Telegram errors (~77 owner turns) | Wrong chat ×3 (name vs id resolution, DM vs group); `ownerTgId: 0`; required-arg guard `!args[k]` treated `0` as missing; 11% of calls failed on near-miss titles; group privacy; old history unavailable through the Bot API | Many fixes, L16742–18344 | Aug 27–28 | ~8 |
| WG23 | Latency and voice quality | Cold 19k-token prefill (27 s to first word); bench runs evicting slot 0; TTS voice regressions | Pre-warm, slot isolation, Kokoro restored (`08ab54e`, `3c86500`) | L29068–29220 | 3 |
| WG24 | Local-model agents competing with her own brain | Spawned threads or switches onto Wendy's GPU | `e863afd`, then M4 Max offload `fbde41b` | L31816, Oct 1–4 | 2 |

### 1d. Infra (IN)

| ID | Symptom / cause | Fix | Where | Recur. |
|---|---|---|---|---|
| IN1 | Whisper shim or speaches dead after reboot, power cycle or terminal close (`nohup &` killed by the shell) | tuistory, then `run-stack.sh`, then systemd user units and the prereqs gate | L1643, L4105, L5173, L6533, L7122, L8686 | ≥6 |
| IN2 | Another project's `stop-live.sh` runs `pkill -9 -f "bun run src/index.ts"`, which also killed the shim | Distinct process title recommended | L7953 | Suspected, several |
| IN3 | git `autocrlf` turned shebangs into `bash\r`, so scripts died silently | `.gitattributes eol=lf` | L6591 | 1 |
| IN4 | WSL2 gets a new IP on each boot, so the `netsh portproxy :2222` rule goes stale; WSL doesn't autostart; the wake flag arrived via SSH into WSL | `fix-projector-ssh.ps1`, Windows-side watcher | L24229–24363, L21258 | 3 |
| IN5 | schtasks watcher flashed PowerShell windows every 60 s | wscript wrapper | L21364 | 1 |
| IN6 | VRAM spill to system RAM (Wallpaper Engine on lock or wake, Chrome/Telegram/dwm, context too large) | Shut the brain down before locking; 196k/144k context profiles | L12885, L14443, L20524–20648, L29637 | 4 |
| IN7 | UAE carrier blocks VoIP, so Wendy cut in and out of voice | Mullvad (Frankfurt), DAITA off | L30551–30715, Sep 28 | 1 (4 turns) |
| IN8 | Remote access to projector and Mac (Tailscale, sshd, macOS firewall) | Tailscale, sshd | L25203–26165 | ~25 turns |
| IN9 | Pushes failed: ssh-agent lost on reboot; GitHub committer-email block | noreply rewrite | L4191, L8580 | 2 |
| IN10 | Duplicate skills (`~/.claude/skills` symlinked into `~/.agents/skills`, both scanned by OpenCode) | Dedupe | L6984–7040 | 1 |
| IN11 | Agent's `pkill -f` / `pgrep` matched its own shell; `&&` chains broke on pkill's exit code | Bracket trick, separate steps | ≥6 mentions (L23729, L26652, L26871 …) | 6 |
| IN12 | Provider (Anthropic) content filter blocked the **builder itself** while it wrote guard wording or refusal tests | Neutral rewording | L31659, L27396 | 2 |

---

## 2. Workarounds that patch or scrape Kimaki from outside

These are what make the stack fragile. Each one breaks if Kimaki changes the relevant internal.

| Workaround | What it depends on | Incidents |
|---|---|---|
| **Launch-time source patch.** `kimaki-prereqs` regex-rewrites `~/.npm/_npx/*/node_modules/kimaki/dist/voice.js` on every launch. It already needed 2 patterns in 5 days. | Exact text of a compiled constant | KB4 |
| **Second gateway on Kimaki's bot token.** The token is read straight from `~/.kimaki/discord-sessions.db` `bot_tokens` (`token.ts`). | DB schema, Discord's multi-session tolerance | MC1, MC8, MC9 |
| **Command re-assertion loop.** Per-command POST, 6 h re-assert, 10-min wipe-detect GET, `!wendy-commands` fallback. | Kimaki's PUT behaviour | KB5 |
| **CLI output scraping.** `runKimaki` runs `exec kimaki … > tmp 2> tmp.err` and reads the file from the end with a 500 KB budget. Lookups are bounded to 2.5–3 s and cached 45 s. Free-text transcript output is parsed back into "last N messages". | CLI flush bug, transcript text format | KB3, WG10, WG11 |
| **Polling instead of events.** Watchers, the change feed and the index walk call `project list` + `session list` + `session read` across ~1,300 sessions. | CLI speed, text format | MC6, WG11 |
| **Direct reads of OpenCode's DB** (`opencode.db`, `ContentFilterError`) | OpenCode schema | MC4 |
| **Direct OpenCode HTTP calls.** `GET /session/{id}/message`, `POST /session/{id}/revert`, and **port discovery across multiple opencode servers per session** | OpenCode server API, which Kimaki owns | MC5, WG18 |
| **Direct writes to Kimaki's `session_models`.** String-built SQL plus a 15 s sweep (dormant now). Wendy also always passes `--model` on sends. | Kimaki DB schema, KB6 | KB6, WG17 |
| **Unmapped voice channel** so Kimaki's Gemini worker never arms | Kimaki voice-channel routing | MC8 |
| **Env wrapper.** Strips 15 `KIMAKI*`/`OPENCODE*` vars; injects `OPENAI_BASE_URL`/`OPENAI_API_KEY` | Env-var contract | KB8, MC2 |
| **Cross-machine restart.** The projector restarts the printer's Kimaki and posts a "verify patch loaded" prompt | Nothing native | MC10 |
| **Abandoned fork and PRs** (#158, #167, #181) | Upstream churn: the fork was 220 commits behind by Sep 29 | MC1, KB1 |

---

## 3. Totals

| Class | Distinct incidents | Approx. owner turns | Approx. tool calls | Notes |
|---|---|---|---|---|
| Kimaki bug (KB) | **8** | ~70 | ~330 | 5 of 8 (KB1, KB3, KB4, KB5, KB6) are chronic or recurring. 4 are confirmed still present in 0.31 source (KB1, KB3, KB4, KB5). |
| Missing Kimaki capability (MC) | **12** | ~110 | ~420 | Includes fork upkeep and the sidecar workaround (MC1), guard plumbing (MC4/5) and polling (MC6) |
| Wendy gap (WG) | **24** | ~260 | ~1,250 | Voice and turn-taking ~50 turns / 243 tools; Telegram ~77 / 201; V2 rebuild 17 / 165 |
| Infra (IN) | **12** | ~90 | ~350 | Whisper backend deaths, WSL/portproxy, VRAM, VoIP block, remote access |
| **Total** | **56** | — | — | Turn and tool totals overlap across classes and are cluster estimates |

Measured clusters: owner turns, tool calls, and minutes of agent time from summed `duration:` lines.

| Cluster | Owner turns | Tool calls | Agent min |
|---|---|---|---|
| Voice ears / turn-taking (WG5–9) | 50 | 243 | ~197 |
| Telegram (WG22) | 77 | 201 | ~282 |
| Multi-node / projector / Mac / Tailscale (IN8, WG21, MC12) | 58 | 264 | ~172 |
| Fork maintenance: PR rebases, analytics.js, fanout, "missing modules", abandonment (KB1, KB2, MC1) | 28 | 174 | ~106 |
| Voice V2 rebuild | 17 | 165 | ~121 |
| Brain lifecycle: start/stop/wake/WSL/VRAM (WG15, IN4, IN6) | 27 | 98 | ~79 |
| Transcription URL / env / launch ordering (KB4, MC2, MC3) | 21 | 94 | ~35 |
| Content-filter detection, guard and recovery (MC4, MC5, WG18) | 11 | 83 | ~34 |
| Whisper stack outages (IN1–3) | 19 | 69 | ~59 |
| Dispatch hallucination / double-send / wrong thread (WG12, WG13) | 9 | 41 | ~32 |
| Thread-read truncation / stale status (KB3, WG10) | 5 | 33 | ~25 |
| Model override reset and pin war (KB6, WG17) | 10 | 32 | ~31 |
| Command wipe (KB5) | 3 | 15 | ~10 |

### Most expensive incidents

1. **Voice ears and turn-taking (WG5–WG9).** About 50 owner turns. Many were self-inflicted regressions; the owner noted "it was more fluid at the start". These are pure Wendy work.
2. **Kimaki fork tax (KB1, KB2, MC1).** About 28 turns and 174 tool calls, ending in abandonment. The one real fix (fanout, PR #181) was lost, and **the bug still ships in 0.31**.
3. **Transcription keeps breaking (KB4, MC2, MC3, IN1).** About 40 turns across all eras: ECONNREFUSED, `[inaudible audio]`, 401 to OpenAI twice. It led to a launch-time patcher and remote restarts. This is the most **recurrent** owner-visible failure, and every root cause is Kimaki's endpoint contract plus process ordering.
4. **Content-filter guard (MC4, MC5, WG18).** About 10 commits in 3 days and 3 failed live runs. One run destroyed ~30 min of good work. It was built entirely by scraping OpenCode's DB and HTTP server because Kimaki exposes no thread state or recovery API.
5. **Model override reset and pin war (KB6, WG17).** Fewer turns, but the **highest frustration** in the log (repeated ALL-CAPS turns). A Kimaki default behaviour, made worse by a DB-writing workaround.
6. **Stale thread status (KB3, WG10, WG11).** The single Kimaki CLI flush bug invalidated every "what's this thread doing" answer until the builder found it. Several fix rounds were spent slicing the wrong data first.

---

## 4. Top 10 opportunities

Tags:

- **Scope:** **K** = Kimaki-native, **W** = Wendy, **B** = both
- **Effort:** S / M / L
- **Route:** **UP** = upstream PR candidate, **FORK** = fork-only (tailored)

| # | Opportunity | Scope | Effort | Route | Evidence | Removes |
|---|---|---|---|---|---|---|
| 1 | **Filter events before enqueue** in `ThreadSessionRuntime`: port the PR #181 `shouldRouteEvent` check before `dispatchAction`, re-checked after dequeue | K | S | UP (PR exists, has tests) | KB1. Still at `thread-session-runtime.ts:990` in 0.31. Threads brick under load. | Chronic multi-thread stalls; restart wedges |
| 2 | **Flush stdout before exit** in `kimaki session read` (and every other `process.stdout.write` + `process.exit` pair). Add `--tail N` / `--json` message output for machine consumers. | K | S | UP | KB3 (`session.ts:448,484`). Wendy's temp-file sink and text parsing (WG10). | Stale-status bug class; the scrape wrapper |
| 3 | **Transcription endpoint as real config.** Honour `OPENAI_BASE_URL` (or a stored per-bot `transcription_base_url`) in `voice.ts`. Health-check it at startup and in a status command. Return a visible error instead of `[inaudible audio]` when the backend fails. | K | S–M | UP (env honour is a regression fix); FORK for the stored setting | KB4 (2 regressions, patched by regex at launch), MC2, MC3, ~40 owner turns | `kimaki-prereqs` source patching; the 401 / ECONNREFUSED / inaudible class |
| 4 | **Non-destructive command registration.** GET existing guild commands and keep any not owned by Kimaki. Or upsert or delete only Kimaki-owned names. Skip when nothing changed. | K | S | UP | KB5. Wendy's 6 h / 10 min re-assert and `!wendy-commands`. | Command wipes on every Kimaki restart |
| 5 | **Model persistence and lock.** `kimaki send` without `--model` must not clear `session_models`. Add a `/model lock` (or `kimaki session model --lock`) that sends and agents respect. | K | S–M | UP for the reset fix; FORK for lock semantics | KB6, WG17, owner frustration peak | DB-write pin sweep; model drift |
| 6 | **Thread health API.** `kimaki session status <id> --json` returns busy / idle / waiting / errored / blocked, last error name (`ContentFilterError`, overloaded, rate limit), model, context %, last activity. Include errors in `session read`. Optionally post a visible marker in Discord on a filter block. | K | M | UP (generic); FORK if scoped to filter | MC4. `filterBlock.ts` reads `opencode.db` directly. | Direct OpenCode-DB scraping; "she can't see it's stuck" |
| 7 | **Event stream for external consumers.** For example `kimaki session watch [--all] --json` or a local IPC/WebSocket feed of `message.completed`, `session.idle`, `session.error` and `thread.created`, plus a `kimaki session list --all --json --since`. | B | M–L | FORK first (fits the gateway/IPC architecture), UP once stable | MC6, WG11 (missed replies, repeats, stale updates), index walk over ~1,300 sessions every cycle | Polling, baseline races, the index walk; makes Wendy's watchers event-driven |
| 8 | **Recovery primitive.** `kimaki session recover <id>`: revert to the start of the failed run, keeping completed tool work. Resend one brief on the pinned model. Dedupe, one in flight, backoff, hold if a human posted recently. Exposed as `/recover` too. | B | M | FORK (opinionated); UP the revert/resend CLI pieces | MC5, WG18 (~30 identical retries, wiped work, model switching, port discovery across opencode servers) | Raw `POST /session/{id}/revert` and server probing; Wendy's guard shrinks to policy |
| 9 | **Kimaki plugin hooks.** Slash command registration, a message preprocessing hook (attachments, replied-to message, replace or claim), lifecycle hooks, voice-channel claim. Align with `docs/opencode-v2-plugin-migration.md`. | B | L | UP (maintainer agreed post-v2); FORK can prototype on v1 | MC1, MC8, MC9; second gateway with token read from DB; fork abandoned | Second gateway, token scraping, "retranscribe" double-handling, VC turf war |
| 10 | **Managed sidecar services and safe restart.** Kimaki config lists dependent services (health URL, start command, required-before-start). Kimaki starts or supervises them, reports them in a status command, and supports a restart/upgrade that re-runs prerequisites and posts a check-in to the requesting thread. On the Wendy side, use it for one supervised process tree and drain-before-deploy. | B | M | FORK | MC2, MC10 (projector restarts the printer's Kimaki), IN1 (≥6 backend deaths), WG15, WG20; owner asked twice to "bundle whisper into the kimaki launch" | `kimaki-prereqs`, cross-machine restarts, manual "boot wendy" turns (~17) |

**Honourable mentions:**

- **K, S, UP:** permission prompts that stay pending instead of timing out and losing the turn (MC11).
- **K, S, UP:** a `--guild` flag for `project add` / channel creation (KB7).
- **K, S, UP:** a documented child-env contract so `env -u ×15` isn't needed (KB8).
- **W, M:** a structured send-ack contract: the `kimaki send` JSON returns a message id, and Wendy's claim guard checks it (WG13).
- **W:** a test-isolation rule so the builder can't touch live Wendy (WG20).

### Suggested order

Items 1–4 are small upstreamable fixes that remove a chronic Kimaki bug or an external patch each. Do them first:

- 1 and 2 already have a diagnosis, and #1 has a tested patch.
- 3 retires the launch-time regex patch.
- 4 retires the re-assert loop.

Items 5–6 retire the two DB-scraping paths. Item 7 is the structural change that would let Wendy drop polling. Items 8–10 move Wendy's hand-rolled orchestration (guard, recovery, lifecycle) into Kimaki primitives, so Wendy keeps only the voice, persona and policy layers.
