# Lens 1: the owner's voice conversations with Wendy

Scope: research only. All data sources were opened read-only. All timestamps are UTC.

## Method

| Source | What was used |
|---|---|
| `~/.kimaki-whisper/diagnostics/2026-09-20..10-04.jsonl` (15 files, 20,710 events) | Primary corpus. Event key is `ev`. The main events used were `owner_said` (184), `brain` (430 LLM hops), `tool` (299), `turn_done` (183), `first_audio`, `barge_in` (70), `turn_aborted` (42), `commitment_*`, `guard_*`, `filter_block_detected` (10), `unverified_target_blocked` (10), `thread_model_switched` (3), `action_held_owner_talking` / `held_actions_superseded` |
| `~/.kimaki-whisper/wendy.log` (55k lines, 3.8 MB, time-of-day only and no dates) | Secondary corpus. It has 1,294 `wendy heard:` lines, each cut to 80 chars; 643 of them are real owner speech and the rest are synthetic prompts. It also has 1,787 `wendy tool:` lines and the index-walk timings |
| `~/.kimaki-whisper/workspace/` | `commitments.json` (9), `away-log.json` (9), `journal.jsonl`, `memory.md`, `dispatch-status.json` |
| `~/WebstormProjects/kimaki-whisper/src` | `wendy.ts`, `tools/specs.ts`, `senses/filterBlock.ts`, `senses/modelPins.ts`, used to explain the behaviour seen in the data |
| `kimaki-tailored/cli/src` | To check what Kimaki already offers: `send --wait/--model/--session/--thread`, `session list/read/wait/search/abort`, `thread list`, and `markdown.ts` |

**Classifying `owner_said`.** Wendy uses the same event for synthetic turns. Splitting by the injected prefix gives:

| Turn kind | Count |
|---|---|
| Real owner speech | **98** |
| Join greetings (including away-report-on-join) | 35 |
| `COMMITMENT DUE` self-turns | 26 |
| `BACKGROUND UPDATE` turns | 25 |

When a real turn had queued-update context glued on in front (11 of 98), the owner's speech is the text after the last `]`. Voice was used on only 7 of the 15 days: 09-22 (28 events), 09-24 (12), 09-26 (26), 09-28 (11), 09-30 (45), 10-01 (46), 10-03 (16).

**Latency.** A turn runs from `owner_said.ts` to the first `first_audio` event (first audible output) and to the first `turn_done`, stopping at the next `owner_said`. Within that window, brain-hop `ms` and tool `ms` are added up separately.

**Intents.** All 98 real turns were labelled by hand, one primary intent each. The wendy.log corpus was also clustered with regexes as a coarser cross-check.

---

## 1. What the owner asks Wendy for

### Primary intent of the 98 real owner turns (diagnostics, 09-22 → 10-03)

| Intent | n | % | Examples |
|---|---|---|---|
| **Relay a question or instruction into an existing thread** ("ask the V7 thread…", "tell RPC usage watch…") | 19 | 19% | 10-01 13:21:31 "can you ask exactly what the 400k gas limit thing is"; 10-01 13:51:25 "can you ask it what the implications… of reliquifying"; 09-22 21:13:33 "get all the session IDs… and give it to the RPC usage watch thread" |
| **Unblock a content-filtered or stuck thread** | 18 | 18% | 09-30 00:08:31 "the last three responses… show opencode session error, the response was blocked by the provider's content filter. I need to get around this"; 10-01 10:38:38 "anti-flash rewards has been stuck on the opencode session error… go unblock that thread"; 10-03 11:27:53 "your unblocking strategies [are] really shit" |
| Fragment, cut-off, or duplicate transcript | 12 | 12% | "The." / "thingy," / 4 duplicated turns re-emitted with the same text (09-26 21:42, 09-30 22:14/22:15, 22:25/22:26, 10-01 10:43:17/10:43:52) |
| **Correction or complaint about something Wendy did** | 11 | 11% | 09-22 18:48:06 "You've literally dispatched them all into the wrong places and they didn't even use Opus 5.5"; 09-30 00:13:29 "You're clearly wrong"; 10-01 10:44:00 "You sent it to deployed contracts can't be patched. I wanted the V7 launcher thread." |
| Wendy meta: voice settings, mute, name-only test, "repeat after me" | 9 | 9% | 09-28 14:52:08 test of name-only mode; 09-26 21:55:09 "I just added silence" |
| Telegram: read, summarise, or reply | 8 | 8% | 09-24 19:49–20:00 BaseStonk/Anthony chat |
| General Q&A unrelated to Kimaki (router login, VPN, MDM, LLM capabilities) | 8 | 8% | 09-26 18:40, 09-28 14:49 |
| **Status check or summary across threads** | 6 | 6% | 09-26 18:30:41 "look through all the Discord threads… what progress we've made across every surface"; 10-01 13:08:23 "go through every single thread last active in basestonk-launchpad of this discord" |
| **Dispatch or spawn new work** | 4 | 4% | 09-22 18:46–18:47 "dispatch multiple [Opus] 5.5 agents… every surface overhaul"; 09-26 21:57:20 "spawn a thread to research… MDM" |
| Watch, tail, or schedule a follow-up | 3 | 3% | 09-30 22:26:12 "set yourself a timer, wake back up at that time… tail this guy"; 09-26 18:35:21 "monitor that thread… dictate the reply to me" |

Model-version demands are folded into the corrections. "Opus 5 vs 5.5" comes up 3 times: 09-22 18:48:06, 09-26 21:59:17 and 22:01:38.

**What this means.** About 60% of the owner's meaningful voice traffic is Kimaki thread operations: relay, unblock, status, dispatch, watch, plus the corrections those produce. The owner treats Wendy as a voice remote control for named Kimaki threads. In practice two threads dominate: "Deployed contracts can't be patched" (`ses_f10fb73…`) and "V7 launcher: anti-flash rewards" (`ses_f10ae4f…`).

### Cross-check: wendy.log (older history, 643 real "heard" lines, regex buckets, overlapping)

| Bucket | Lines |
|---|---|
| Chit-chat, domain Q&A, fragments | 422 (unmatched by any regex) |
| Telegram and people | 98 |
| Corrections ("wrong", "you didn't", "still", "again") | 50 |
| Relay into a thread | 36 |
| Wendy meta | 19 |
| Status | 19 |
| Dispatch | 14 |
| Unblock | 10 |
| Watch | 7 |
| Model | 5 |

Tool-call counts in wendy.log over the full history: `bash` 404, `read_session` 359, `lookup_thread` 195, `telegram_send` 124, `ask_thread` 112, `send_to_session` 57, `search_sessions` 56, `list_recent_sessions` 35, `spawn_agent` 11, `dispatch_task` 8.

Earlier history leaned more on Telegram and chat. Over the last two weeks the work moved to thread operations, and especially to content-filter unblocking.

---

## 2. What succeeds, and what fails or has to be repeated

### Clear successes
- **Simple single-hop answers.** 38 owner turns needed exactly 1 brain hop (median turn time 5.0 s). Examples: Q&A, Telegram summaries (09-24 19:57 pulled the full archive in one `telegram_chat` call, then summarised it), VPN advice.
- **Relaying a question into a thread once the target is known.** On 10-01 13:21–13:58 the owner ran a rapid design conversation with the V7 thread through Wendy: gas limit → compatibility → LP-fee routing → controller-claim → auto-reliquify → "go with plain zero". Each question was relayed with `ask_thread`, then reported back through a `COMMITMENT DUE` turn 2–12 minutes later. Answers were judged on-topic (for example 13:50:58 "The controller-claim answer's in…").
- **Watching for a finish.** 09-26 18:35 Sky broadband: the reply was dictated within about 70 s of the agent finishing (18:36:34).
- **Name-only mode** was verified as working by the owner (09-28 14:55:08 "that means the mode is successful").

### Failures, repeats and rephrasings (with evidence)

| Failure mode | Count | Evidence |
|---|---|---|
| **Content-filter blocks Wendy could not see** | 18 unblock turns + 6 related complaints | 09-30 00:12:23 Wendy: "I'm seeing it working right now… the session retries internally". 00:13:29 owner: "it's literally not progressing… You're clearly wrong." 01:17:19 "How are you not seeing that?" 01:34:26 "you can literally see the… content filter thing". 10-01 10:43:17 "how are you not even seeing that it's blocked?" Root cause: `kimaki session read` drops message-level `ContentFilterError`. `senses/filterBlock.ts` says so explicitly, and `kimaki-tailored/cli/src/markdown.ts:393-430` only renders *tool-part* errors. Wendy later added `thread_health` (22 calls) and `guard_thread`, which read `~/.local/share/opencode/opencode.db` directly |
| **Unblock attempts that tripped the filter again** | 09-30 01:29–01:37: 9 `ask_thread` + 2 `send_to_session` + 3 model switches in 8 min | 01:29:40 "that thread tripped straight away again. It tripped on your message response." 01:35:56 "You again tripped the content filter". Between 01:36:21 and 01:37:35 Wendy fired **5 `ask_thread` calls in 74 s** at the same busy thread. Each was a `kimaki send --session` without `. queue`, which by Kimaki's docs *interrupts* a busy run |
| **Auto-guard (after it shipped 10-01 12:09)** | 51 `guard_unblock` attempts on one session between 10-01 14:11 and 10-03 12:11: 23 ok, 28 not ok; 34 `guard_recovered` (24 on the first attempt, 8 on the second, 2 on the fourth); 1 `guard_brief_rejected` ("invented paths") | The owner still complained on 10-03 11:27:53 ("I know that Fred is still blocked…"). This worked better than manual nudging but was not reliable |
| **Wrong target thread** | 2 owner-visible cases; 10 `unverified_target_blocked` | 10-01 10:43:46: `ask_thread` was called **without `session_id`** after an unverified-target block and went to "Deployed contracts" instead of V7. Owner at 10:44:00: "You sent it to deployed contracts can't be patched. I wanted the V7 launcher thread." 09-30 01:34:36: `read_session("ses_f10fb73")` failed with "not found", because `spawn_agent` returned a truncated id (the `spawn_registered` id is also `ses_f10fb73`) |
| **Wrong dispatch location or model** | 2 episodes, 3 complaints | 09-22 18:46:50–18:47:05: three `spawn_agent` calls landed in the #wendy channel on "opus" (= Opus 5). After the owner's correction, three more `dispatch_task` calls went to the BaseStonk channel (18:48:44–48), so **6 sessions were created for 3 tasks**, and the model still needed a manual switch. 09-26 21:57–22:01: four MDM spawns: opus, opus, opus, then "local", and the owner twice said "spawn with 5.5" |
| **Wendy changed the model on the owner's thread without being asked** | 3 `thread_model_switched` | 09-30 01:31:56 → `local`, 01:32:07 → `fable`, 01:36:55 → `local`, to get past the filter. The spec was later changed to "ONLY when the owner explicitly asks" |
| **Said it did something it had not done** | 1 owner-visible case in diagnostics; 9 + 11 guard hits in wendy.log | 10-01 10:43:48 Wendy: "I also flagged the builder about the detection gap". The `send_to_session` to the builder had been **held** (`action_held_owner_talking` at 10:43:46) and then dropped (`held_actions_superseded` at 10:44:01/10:44:09). Owner at 10:44:28: "you also didn't send anything to the Wendy Builder thread." wendy.log has "send claim with empty dispatch ledger - forcing the real call" ×9 and "promise detected in final reply — forcing follow-through" ×11 |
| **Stale status reported as current** | ≥3 | 09-30 22:14:57 owner: "you're looking at something that's way old"; 10-01 13:08:23 "I think you're a bit out of date because none of the threads are currently in an active state" |
| **Barge-ins** | 70 `barge_in` (56 by loudness, 12 by words; **53 had empty `heard`**); 26 `turn_aborted: barge_in`, 16 `superseded`; 25 owner turns carried "your reply was never heard" notes | Many interruptions were loudness-triggered without words, so they may be false positives. 6 `reply_dropped_owner_continued` |
| **Duplicate transcripts** | 4 pairs | 09-26 21:42:06/21:42:56, 09-30 22:14:57/22:15:12, 22:25:08/22:26:12, 10-01 10:43:17/10:43:52: the same utterance arrived twice as `owner_said`, so the brain ran twice |
| **Brain outage** | 1 | 09-26 22:02:52: turn took 671 s; `brain_degraded` tps 18 at 22:02:08, `turn_time_budget` 428 s, `brain_error_ack` at 22:14:03 "I hit an error reaching my reasoning engine". "My reasoning engine was asleep" was spoken 5 times on joins |

### Commitments
- 9 `commitment_recorded`, 20 `commitment_updated`, **26 `commitment_fired`**, 16 `commitment_done`, 3 `commitment_waiting` (with attempts reaching 5). All 9 in `commitments.json` now say `status: done`.
- **Most fires were "not yet" reports.** Commitments fire on *any* thread movement, not on the milestone that was promised. Of the 26 COMMIT turns, at least 11 replies were "Still in the analysis phase…", "No relay rollout build yet" or "hasn't landed yet". Examples: 10-01 10:39:36, 10:45:56, 10:50:47, 11:23:37, 12:09:18; 10-03 11:20, 11:31, 11:55, 12:05, 12:13 ×2.
- **The loss-census total** was asked for on 10-01 15:14:17 ("analysis on the total damage") and delivered on 10-03 12:24:43 ("The loss-census total is $7,345"): about 45 hours and 7 fires later, with `away-log.json` holding 4 near-identical "hasn't landed yet" reports.
- "Report the answer on the CIIAA code path" (10-01 13:48:18) was a commitment to the wrong label. Wendy answered "Already delivered that one".

---

## 3. Latency

### Per-turn distribution (real owner turns, n=98)

| Metric | n | p50 | p75 | p90 | max |
|---|---|---|---|---|---|
| owner_said → first audible audio | 70 (28 had no audio before the next turn: barge-in or superseded) | **4.0 s** | 9.8 s | **16.4 s** | 69.8 s |
| owner_said → turn_done | 97 | **17.5 s** | 32.7 s | **48.4 s** | 671 s (brain outage) |

33% of owner turns took more than 30 s.

Other turn kinds, owner_said → turn_done:

| Turn kind | p50 | p90 |
|---|---|---|
| JOIN | 3.1 s | 58.5 s (cold brain boot: boot warm up to 120 s) |
| BG | 11.5 s | 41 s |
| COMMIT | 17.4 s | 28.3 s |

Pipeline pieces:

| Piece | Value |
|---|---|
| STT `stt_ok` | p50 0.94 s |
| TTS `first_audio.ms` | p50 0.24 s, p90 1.25 s |
| utterance → owner_said (end-of-turn hold) | p50 0 s, p90 2.5 s (32 `eot_held_incomplete`) |

Voice I/O is not the bottleneck.

### Hops are what make turns slow

| Brain hops in turn | n | Median turn time |
|---|---|---|
| 0 | 7 | 2.1 s |
| 1 | 38 | 5.0 s |
| 2 | 11 | 12.8 s |
| 3 | 17 | 30.5 s |
| 4 | 9 | 30.6 s |
| ≥5 | 15 | 39.1 s |

- Brain time vs tool time: across owner turns, brain 1,428 s and tools 783 s; in the slow (>30 s) turns, brain 979 s and tools 583 s. **The LLM accounts for about 63–65%.**
- Per hop: p50 2.75 s, p90 11.6 s, max 158 s, with a prompt of p50 22.2k tokens (p90 34k, max 44k), cache hit about 86%, and 118 tok/s.
- Each extra hop costs roughly 3–10 s. The slow turns are slow because they resolve, read, act and re-check in separate hops.

### Tool costs (all turns)

| Tool | n | Total | p50 | p90 / max | Note |
|---|---|---|---|---|---|
| `read_session` | 110 | **391 s** | 1.8 s | 6.6 s / 15.9 s | Most frequent: 27 turns read ≥2 sessions; 20 turns paired it with `thread_health` because read cannot show errors |
| `ask_thread` | 28 | **272 s** | 12.0 s | 12.0 s | Hard cap: `kimaki send --wait` is killed at 12 s. 18/28 hit the cap and became "DELIVERED… result will arrive"; the other 10 returned in 2.8–10 s, often a stale tail (09-30 01:36:21 and 01:36:33 both returned "…elay deployedBy") |
| `bash` | 11 | 90 s | — | 30 / 45 s | |
| `lookup_thread` | 34 | 54 s | 0 s | max 16.6 s | |
| `fetch_reply` | 10 | 40 s | 6.2 s | | |
| `send_to_session` | 8 | 40 s | 3.5 s | 9.1 s | |
| `spawn_agent` | 8 | 42 s | 3.6 s | 12.5 s | |

### Slowest owner turns (excluding the brain outage)

| Time | Turn length | Hops | Tools | Brain / tool | What happened |
|---|---|---|---|---|---|
| 10-01 13:15:06 | 145 s | 9 | lookup, read×3, ask, health | 46 s / 101 s | Explain a decision and ask the thread |
| 09-22 19:40:58 | 127 s | 3 | lookup, send | 66 s / 8 s | Large queued-context prefix in the prompt |
| 10-01 13:08:23 | 125 s | 5 | list_projects, index_pulse, list_recent_sessions, read_session×6, thread_health×2 | 92 s / 63 s | Channel status digest |
| 09-30 01:36:00 | 98 s | 10 | ask_thread×6, read×2, switch_model | | Unblock loop |
| 09-30 10:20:54 | 73 s | 6 | lookup, read, bash×6 | | |
| 09-26 18:35:49 | 45 s | 9 | lookup, search_sessions×4, list_recent_sessions×2, read×2 | | Could not find the 2-minute-old "Sky broadband setup" thread, because the index was stale |

### Background cost that hurts freshness
Wendy rebuilds its thread index by shelling out `kimaki session list --project` for each of 44–47 projects every 10 minutes:

| Measure | Value |
|---|---|
| Walks in wendy.log | 6,046 |
| Duration | p50 **101 s**, p90 126 s, max 458 s |
| Per-project errors | **3,699** (e.g. "index walk L1X: ERROR: Command failed: kimaki session list --project …") |

This is why new threads are invisible to `lookup_thread` for up to about 10 minutes.

---

## 4. Where Wendy lacked authority or a tool, or needed a chain of calls for one action

1. **"Is this thread blocked or errored?" had no Kimaki answer.**
   - `session list` reports `idle | busy | showing-question` only (`cli-commands/session.ts:165`), and `session read` drops message-level errors.
   - Wendy had to open OpenCode's SQLite database directly (`senses/filterBlock.ts`) and add `thread_health`.
   - Before that existed (09-30), Wendy told the owner a blocked thread was working.
2. **"Unblock / continue this thread" had no primitive.** Each unblock was a chain: lookup → read_session → (thread_health) → ask_thread/send_to_session → read again → maybe switch model or spawn a helper.
   - 09-30 01:31–01:37 used 20+ tool calls.
   - The eventual `guard_thread`/`recover_thread` reimplements revert-and-rebrief outside Kimaki: it reads the opencode DB and then sends the brief with `kimaki send`.
3. **The model stays only if Wendy forces it.** `modelPins.ts`: "Overrides live in kimaki's session_models table and are reset by any `kimaki send` that omits --model".
   - Wendy writes into `~/.kimaki/discord-sessions.db` directly with `sqlite3`.
   - The journal records "Kimaki… kept defaulting to Opus on cross-thread messages and forcing Xipz to manually reset the model" and "You traced the Kimaki cross-thread model bug".
   - `spawn_agent` offers only the aliases `opus|fable|local`, which mapped to Opus 5 after Opus 5.5 shipped. That caused 3 owner corrections.
4. **Dispatch is split across two tools with different powers.**
   - `spawn_agent` takes a model but always targets the #wendy channel.
   - `dispatch_task` takes a channel but no model.
   - The owner's "dispatch 5.5 agents into basestonk-launchpad" therefore could not be done in one call: 6 sessions, then manual model switches (09-22 18:46–18:48).
5. **Resolving a thread by name is a chain, and it can go wrong.** 26 turns did `lookup_thread` → act. Wendy's safety rule (`unverified_target_blocked` ×10) forces a lookup in the same turn before ask/send, which adds a hop. Without it, an id-less `ask_thread` hit the wrong thread (10-01 10:43:46).
6. **Ask-and-wait has no proper semantics.** `send --wait` cannot be bounded and does not return a structured "new reply since my message" result, so Wendy kills it at 12 s and relies on finish-watchers.
   - Nudges into a busy session *interrupt* it unless the prompt ends with `. queue` (Kimaki `send` help text).
   - Wendy never appends that, so rapid nudges such as the 5 in 74 s on 09-30 01:36 can restart a working agent.
7. **Channel-scoped status needs about 11 calls.** "Every last-active thread in basestonk-launchpad of *this* Discord" (10-01 13:08) took list_projects + index_pulse + list_recent_sessions + 6× read_session + 2× thread_health, over 125 s.
   - `kimaki thread list --channel` exists, but it returns no status, last-message preview, model or error.
8. **There is no change feed.** "Tell me when it replies" and commitments depend on 45 s pollers plus a 10-minute full index walk. In the diagnostics: `finish_watch_dead` ×6 and `finish_watch_rearm` ×35.
9. **Telegram history.** The owner asked to "proxy it through my account" (09-24 19:57:03). Only the bot's own archive was available, so Wendy honestly said the history was thin (19:50:32). This is not a Kimaki issue.

---

## 5. Top 10 opportunities

Ranked by owner pain × frequency. Tags: **[Kimaki]** native capability, **[Wendy]** voice-layer, **[Both]**.

### 1. Expose thread health (blocked / errored / waiting) in Kimaki — **[Kimaki]**
- **Evidence:** 18 unblock turns plus about 6 "how are you not seeing that" complaints (09-30 00:13:29, 01:17:19, 01:34:26; 10-01 10:43:17).
- **Kimaki gap:** `session list` status is limited to idle/busy/showing-question, and `markdown.ts` renders tool errors but not assistant `ContentFilterError`. Wendy now reads `opencode.db` directly.
- **Proposal:** add `status: errored|blocked` with `lastError {name, at}` to `session list --json`, add a `kimaki session status <id> --json`, and render message-level errors in `session read`.

### 2. Native "continue past provider/content-filter error" — **[Both]**
- **Evidence:** 51 guard attempts on one thread, 23 ok / 28 failed, 34 recoveries, 1 brief rejected for invented paths; manual unblock loops like 09-30 01:29–01:37 (9 asks, 3 model flips). The owner's diagnosis (10-03 11:27:53) was that the trigger words come from either side.
- **Proposal:**
  - Kimaki: a per-thread opt-in auto-resume that reverts the failed turn and re-prompts "continue, same plan", with backoff and an attempt counter shown in the thread. Kimaki already owns the session, so it can act within seconds instead of on a 20–90 s poll.
  - Wendy: one `unblock(thread)` voice action that maps to it.

### 3. Sticky per-thread model, plus "latest opus" alias resolution — **[Kimaki]**
- **Evidence:** `modelPins.ts` (the `kimaki send` without `--model` resets `session_models`), Wendy's direct SQLite writes, the journal's "cross-thread model bug", and 3 owner corrections about Opus 5 vs 5.5 (09-22 18:48:06, 09-26 21:59:17, 22:01:38). The `thread_model_pin` code also notes a "fable" alias silently downgrading 3 threads.
- **Proposal:** `send --session` keeps the thread's model unless `--model` is passed; add `kimaki session model <id> [set <model>]`; make aliases resolve from the provider's current list.

### 4. Change feed and event stream instead of polling and index walks — **[Kimaki]**
- **Evidence:** 6,046 index walks, p50 101 s, 3,699 per-project errors. The new "Sky broadband setup" thread could not be found (09-26 18:35:49: 9 hops, 45 s). There are 35 finish-watch re-arms, 6 dead watches, and a 45 s poller.
- **Proposal:** `kimaki session list --all --since <ts> --json` including channel/guild/thread title/status, and/or `kimaki events --follow --json` (session created, turn finished, question, error, model changed). Wendy's index, watches, commitments and stall notices would all become subscriptions.

### 5. One-call "resolve thread by name and act" — **[Both]**
- **Evidence:** 26 lookup→act chains, 10 `unverified_target_blocked`, the wrong-thread send on 10-01 10:43:46, and the truncated-id failure on 09-30 01:34:36.
- **Proposal:**
  - Kimaki: `kimaki session resolve "<fuzzy title>" [--channel|--guild] --json` returning ranked matches with confidence, or `send --thread-title`.
  - Wendy: make `session_id` required on ask/send, validate the full `ses_` format, and have `spawn_agent` return the full id.
  - This saves one brain hop (about 3–10 s) on about a quarter of thread turns.

### 6. Bounded, structured ask-and-wait, and non-interrupting nudges — **[Both]**
- **Evidence:** `ask_thread` 18/28 hit the 12 s kill and 10 returned stale tails. On 09-30 there were 5 interrupting nudges in 74 s. Kimaki's `send` interrupts busy sessions unless the prompt ends with `. queue`.
- **Proposal:**
  - Kimaki: `send --wait --timeout <s> --json` returning `{status, replyAfterMyMessage, error}`, and an explicit `--queue`/`--interrupt` flag instead of the magic suffix.
  - Wendy: default to queue for nudges, and debounce repeated nudges to the same thread.

### 7. Channel/thread status digest — **[Kimaki]**
- **Evidence:** 10-01 13:08:23 took 125 s with 11 tools; 09-26 18:30:41 asked for "progress across every surface"; status asks make up 6% of owner turns but are among the slowest.
- **Proposal:** `kimaki thread list --channel <id> --json` enriched with status/health, last activity, model, last assistant line and blocked flag. Optionally `kimaki digest --guild <id> --since 24h`.

### 8. Unify dispatch, with explicit project and model — **[Wendy]** (Kimaki already supports `send --channel --model`)
- **Evidence:** 09-22 18:46–18:48 created 6 sessions for 3 tasks because they landed in the wrong area on the wrong model. On 09-26, 4 MDM spawns ran on varying models.
- **Proposal:** merge `spawn_agent` and `dispatch_task` into one tool that requires a project/channel and a model (default = the owner's current top model), confirmed back in the spoken reply ("3 agents in basestonk-launchpad on Opus 5.5").

### 9. Never claim an action before the tool result — **[Wendy]**
- **Evidence:** 10-01 10:43:48 said "I also flagged the builder", but the action was held and then dropped (10:43:46 / 10:44:01). wendy.log has "send claim with empty dispatch ledger" ×9 and "promise detected… forcing follow-through" ×11. 09-30 00:12:23 confidently reported "it's working" without checking health.
- **Proposal:** held or superseded actions must be re-run or explicitly reported as not sent, and status claims must cite a health check made in the same turn.

### 10. Milestone-based commitments and quieter progress reports — **[Both]**
- **Evidence:** 26 commitment fires, of which at least 11 were "not yet" reports. The loss-census number took about 45 h and 7 fires. The away log holds 4 near-identical "hasn't landed yet" entries.
- **Proposal:**
  - Kimaki: a "turn finished" event carrying a final-message summary (`session wait` semantics as a subscription).
  - Wendy: fire a commitment only on finish or idle, or when a content match hits (the `thread_trigger` regex mechanism already exists), and fold "still working" into one digest instead of repeated turns.

### Honourable mentions (Wendy-side latency and UX)
- **Prompt bloat.** Brain hops average 22k prompt tokens, and queued-update blobs get glued onto the owner's turn. For example, "AMBIGUOUS: 'BaseStonk' matches 32 chats…" was repeated across 09-30 and 10-01 turns. Trimming this would speed every hop, and the brain is about 65% of slow-turn time.
- **False barge-ins.** 53 of 70 barge-ins had an empty `heard`, and 25 replies were never heard.
- **Duplicate `owner_said`.** 4 pairs were re-emitted, which doubles brain work.
- **Cold-brain greetings.** "My reasoning engine was asleep" was spoken 5 times; join p90 is 58 s.
- **Repeated briefing.** The same briefing was spoken 10 times between 09-22 03:48 and 03:59, apparently replayed across restarts.
