# Lens 3: How the owner uses Kimaki directly

Owner: Discord id `1373950239303532656` (display name "Xipz"; Feb–Mar messages carry `<discord-user name="Xipz" />` with no id).
Snapshot taken 2026-10-04 19:04 (+04). The "last 60 days" window is 2026-08-05 → 2026-10-04. Everything was read-only.

## 0. Data and method

| Source | Notes |
|---|---|
| `~/.local/share/opencode/opencode.db` (93 GB) | 19,017 sessions, of which 17,277 are root sessions. **11,414 of them are an automated batch in `/home/xipz` titled `CLARITY: n` (Mar–May).** They are not direct usage, so they're excluded. |
| `~/.kimaki/discord-sessions.db` | 630 `thread_sessions`, 42 `scheduled_tasks`, 23,914 `scheduled_task_runs`, 273k `session_events` (Mar 7 → now), 848 `ipc_requests`, 11 `session_sleeps` |
| `kimaki task list` | 13 live tasks |
| `~/.kimaki/kimaki.log`, `restart.log`, `service.log` | Current run only. Mostly `openai-rotation` noise. |

Extraction scope: the 628 Kimaki-mapped sessions that exist in OpenCode, plus every session updated in the last 60 days. That's 934 sessions, 27,397 user messages, and an extraction time of 17 s, all via the indexes `message_session_time_created_id_idx` and `part_message_id_id_idx`. The script never scanned `part` without a filter.

How each user message was classified (from synthetic parts and text):
- `owner`: the tag carries user-id 1373950239303532656, or name="Xipz".
- `scheduled`: the text, with any `» **kimaki-cli:**` prefix stripped, starts with a `scheduled_tasks.payload_json.prompt`. Thread-targeted scheduled runs show up as kimaki-cli messages *under the owner's id*.
- `kimaki-send`: a `» **kimaki-cli:**` prefix or bot id 1468321363419992154. These are messages agents and scripts posted via `kimaki send`.
- `agent-dispatch`: the first message of a thread contains a `<embed> Footer: start: true …` block, i.e. a thread created by an agent running `kimaki send`. Because it carries the owner's id it would otherwise look like an owner message.
- `other-user`: collaborators Falcs (1,496 messages) and helixtrades (169).
- `no-discord-tag`: subagent sessions (task tool) or TUI and external sessions.

Totals: owner 19,320 · scheduled 2,291 · kimaki-send 1,069 · other-user 1,668 · untagged 3,049.

---

## 1. How he dispatches work

### 1.1 Volume over time (owner-typed messages)
| Month | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct 1-4 |
|---|---|---|---|---|---|---|---|---|---|
| owner msgs | 1,246 | 2,149 | 1,360 | 1,371 | 1,550 | 4,088 | **5,076** | 2,243 | 237 |

In the last 60 days he sent **7,145 messages into 170 sessions**. He was active on all 61 days, touched a median of 9 threads per day (max 17), and was active around the clock. The busiest hours are 22:00–09:00 local; the trough is 11:00–16:00.

### 1.2 New threads vs follow-ups: the shift to orchestration
Kimaki threads by who wrote the first message (`thread_sessions` joined to the first user message):

| Period | Owner-typed | Agent-dispatch (`kimaki send`) | Scheduled | Collaborator | Untagged/TUI |
|---|---|---|---|---|---|
| Feb–Jul 4 (older) | 292 | 49 (38 with parent = btw/fork/child) | 1 | 15 | 99 |
| **Last 60 d** | **44** | **102** (72 with parent session) | 19 | 6 | 1 |

- He is a **follow-up-heavy steerer**. The median owner-thread gets 2 messages, but the 90th percentile gets 46 and the maximum is 2,682 (`ses_35a242ae2ffe…`, the Reversion monorepo thread, Mar 1 → Jul 20).
- In the last 60 days, **69% of his messages (4,923 / 7,145) went into threads his agents created** (104 threads). Only 1,351 went into threads he started himself. Another 1,637 went into threads more than 60 days old.
- Agents also post into threads: 909 `kimaki send` messages and 2,250 scheduled-prompt messages arrived in the last 60 days.
- `/fork` titles ("(fork #n)"): 17 sessions. `thread_sessions.parent_session_id` is set on 126 threads; nearly all are agent-dispatch children, and only 1 is an owner-typed btw/fork.
- `/queue`: `thread_queue_items` is empty right now, and nothing shows explicit queue use. The **5,824 `MessageAbortedError`** errors are the strongest signal here: 4,713 of them (81%) are followed by an owner message. **He interrupts running turns by typing instead of queueing.**
- `kimaki_sleep`: 11 sleeps. 9 were `cancelled`, because a new message cancels the sleep; 2 were `consumed`.
- Action buttons: 776 `ipc_requests` with `action_buttons` and 72 with `file_upload`. He clicked buttons 508 times ("User clicked: Commit & push", "Keep going", "Hand to fable with full diagnosis", …).
- Long prompts arrive as file attachments: **126 owner messages are "Prompt attached as file"**, and they are the most common way an owner thread starts (126 of 472). The median first-message length is 735 characters.
- 6,579 of his messages (34%) carry images (screenshots). **1,626 are image-only with no text**, which is mostly UI-feedback loops (210 messages mention mobile/UI).

### 1.3 Agents and models
- Agent: `build` on 19,316 of 19,320 owner messages; `plan` was used 4 times. Agent switching is effectively unused.
- Owner-message model, all time: opus-5 5,791 · opus-4-6 4,226 · fable-5 2,622 · opus-4-8 2,541 · opus-4-7 1,712 · fable-5-1 1,135 · opus-5-5 678 · gpt-5.6-sol 267 · gpt-5.4 201 · local Qwen 27B 95.
- Last 60 days: opus-5 3,539 · fable-5 1,697 · fable-5-1 1,135 · opus-5-5 678 · gpt-5.6-sol 81 · local 14.
- **Model switches inside a session:** 532 of 22,152 consecutive human/scheduled turns, across 97 sessions. Top pairs: fable-5→opus-5 (97), opus-5→fable-5 (94), opus-5→fable-5-1 (49), fable-5-1→opus-5 (38), gpt-5.6-sol↔opus-5 (53). By month: Jul 111, Aug 217, Sep 152.
- **Unwanted model drift is a recurring complaint.** Evidence:
  - 07-22 `ses_17c19ca7cffe…`: "you keep picking opus 4.8 fast it always gives an error"
  - 08-08 `ses_0a8002c63ffe…`: "it somehow switched to opus 5 so i manually swapped it back to fable 5"
  - 08-20 `ses_fe0a8d682ffe…`: "YOU KEEP TRIGGERING THE ARCHITECTURE REVIEW THREAD TO BECOME OPUS 5 INSTEAD OF claude-fable-5"
  - 08-24/25 `ses_fce416518ffe…`, 7 messages: "Hand off … BE EXTREMELY CAREFUL TO ENABLE FABLE 5 and NOT OPUS 5"; "your prompts are switching that thread from Fable to Opus"
  - 09-03/04 `ses_0a36ff279ffe…`: "They keep going back to fable 5 … pinned to 5-1"; "Stop auto-changing the model back"
  - 10-01: "do not switch to local as it compromises Wendy"
- **Likely root cause:** **112 of 171** agent `kimaki send` footers carry no `model:`. Some of those threads therefore resolved through the global default, which is now `anthropic/claude-opus-5-5` and changed several times. The other dispatches pass the *sender's* model. There are also stale channel pins: Kybera_Landing and Insurance-Optimizer are still on opus-4-6, Reversion and narrative-finder on opus-4-7, ContextTemple on local Qwen. Precedence is session > agent > channel > global (`commands/model.ts:393`).

### 1.4 Cross-project
- Kimaki threads by directory (all time): WebstormProjects root/hub 195, BaseStonk 101, topofx 62, Reversion 55, Launchpad_Bridge_Platform 43, SmartTrader 41, others ≤16. There are 44 channels across 38 directories.
- Last 60 days, owner messages: BaseStonk 3,900 · Launchpad_Bridge_Platform 1,406 · WebstormProjects (hub) 1,237 · Local-LLM/Wendy 431 · Xipz-Steller 75. 16 directories in total.
- The hub channel (`/home/xipz/WebstormProjects`) is used for personal and life topics:
  - `ses_35e3860b2ffe…`: a health/diet thread with 2,608 owner messages from Feb 28 to now, including 341 food/macro log lines such as "1 patty 1 cheddar" and "5g lemon juice"
  - a Hinge profile thread
  - Gymbox/Hinge reminders run as `at` tasks
- Collaborators steer threads too: Falcs sent 1,496 messages (for example "are you online" ×17, "what's the status" ×8).

---

## 2. Recurring manual actions (owner messages, regex clusters)

| Cluster | All time | Last 60 d | Typical text |
|---|---|---|---|
| Image-only screenshot (no text) | 1,626 | 620 | (UI bug or mobile screenshot) |
| Button click | 508 | 216 | "User clicked: Commit & push", "Keep going" |
| **Proceed/go/continue nudges** | **499** | **214** | proceed 186, go 73, keep (it) pushing ~110, continue 36, "continue from where you left off" 17, okay go 14, resume 9 |
| **Frustration/profanity** | 398 | 185 | "wtf", "genuinely stop pissing me off with the early terminations", "ARE YOU DUMB…" |
| **Status probes** | 358 | 147 | "?" 150, "???" 19, "?????????" 6, "status", "done?", "whats the issue?", "anything outstanding?", "everything okay?" |
| Food/macro logging (personal thread) | 341 | 96 | "1 patty 1 cheddar", "8g mustard", "171g fage" |
| Commit/push/deploy | 308 | 94 | "commit and push all changes" 36 (+30 untagged), "push to prod" 10 |
| Thread orchestration ("that thread/agent", spawn, hand off) | 367 | 161 | "Hand off to a fresh fable-5 session…", "tend to the threads" 8, "sync" 39, "sync crestly" 8 |
| Compaction/context/handoff | 175 | 81 | "hand off to another agent with comprehensive context" |
| UI/mobile feedback | 210 | 119 | "on mobile a solid header is needed fyi" ×9 |
| Stuck/hung/not responding | 105 | 39 | "not responding", "Should I reboot the WSL?" |
| Hallucination/lying accusations | 78 | 36 | |
| Model-switch talk | 75 | 32 | see §1.3 |
| Read-only / don't block another thread | 59 | 40 | "just dont interrupt/block fable bro" |
| Retranscribe/voice | 31 | 17 | "retranscribe" ×10 |
| Why did you stop | 18 | 11 | "who told you to stop" |
| Wake/boot Wendy | 15 | 11 | "boot wendy", "wakey wakey sunshine" ×6 |
| Stop/abort | 11 | 3 | |

Short messages of 40 normalized characters or fewer make up **7,116 of 19,320 (37%)** of everything he types.

---

## 3. Failure modes

Assistant-message errors: 6,316 across 365 sessions.

| Class | All | Last 60 d | Notes / examples |
|---|---|---|---|
| `MessageAbortedError` | 5,824 | 2,283 | 81% followed by an owner message, i.e. self-interrupts. Top sessions: `ses_35a242ae2ffe…` 624, `ses_33e11471affe…` 393, `ses_04abf2f1fffe…` 353 |
| **Content filter** ("blocked by the provider's content filter"; 2× OpenAI `cyber_policy`) | 204 | 139 | Peaks Jul 60, Aug 106, Sep 32. Hot threads: `ses_0b1198d00ffe…` (wallet clusters) 21, `ses_f10fb73c7ffe…` ("Deployed contracts can't be patched") 20, which spawned "You are unblocking a stuck agent thread…" (`ses_f100f156bffe…`), and `ses_050d92f47ffe…` (Arc bridge) 17 |
| Assistant-prefill unsupported | 94 | 31 | Happens on resume after an abort. `ses_35e3860b2ffe…` 15, `ses_050d92f47ffe…` 13 |
| Overloaded | 34 | 30 | 6 of these failed scheduled-task 26 runs |
| Context overflow / "too large to compact" | 45 | 6 | Includes "prompt is too long: 6,498,978 tokens > 1,000,000" |
| Image too large (>2000px multi-image) / bad media type | ~50 | 0 | Screenshot-heavy workflow; fixed since |
| Auth/OAuth/quota ("out of extra usage", invalid_grant, "OAuth not allowed", "claude code 2.1.x does not support this model") | ~35 | ~8 | Version-gate errors are recent (5 in the last 60 d) |
| Local llama launcher exit | 4 | 4 | Wendy/local model |

Other failure signals:

- **Pending questions:** of 164 `question.asked` events, 88 were replied to. That leaves **76 unanswered across 54 sessions** (Sep 16, Oct 6). He usually answers by typing a message, which drops the question.
- **Compaction:** 648 summary messages across 106 sessions. The worst are `ses_35a242ae2ffe…` with 102 compactions, `ses_17c19ca7cffe…` with 22, and `ses_35e3860b2ffe…` with 20.
- **Very long sessions:** 38 sessions peaked above 800k context and 99 above 400k. 69 sessions lived more than 7 days and 35 more than 30 days. The top 12 by tokens each have 1–11 B cache-read tokens. Notional cost across the 934 sessions is $74.6k, with $43.4k created in the last 60 days. That figure is API-equivalent pricing; real billing is subscription/OAuth.
  - `ses_fe99e9c80ffe…` "Verify COINc pool opening": **$6,441**, 2,077 user turns, 968k max context. This is the **task-26 heartbeat** thread.
  - `ses_fabe65ba1ffe…` BaseStonk design pass: $5,774, 983k context.
  - `ses_050d92f47ffe…` Arc bridge: $5,146.
  - `ses_fb35bcab3ffe…` RPC usage watch (daily task 43/51): $3,350.
- **Orphans:** 1 `thread_sessions` row whose session is missing in OpenCode. 78 threads were synced from `external_poll` (TUI). Kimaki has no notion of "dead" threads, and 35 sessions are more than 30 days old and still receiving traffic.
- **Restarts:** `restart.log` shows bot restarts that re-send "Resuming with HANDOFF context (fork #1)" to Wendy's session `ses_0a36ff279ffe…`. The current log has a git `repack` cleanup failure and per-event `openai-rotation` INFO spam (several lines per second).

---

## 4. Scheduled tasks

There are 42 tasks: 13 planned, 25 cancelled, 4 completed. Most are BaseStonk ops monitors created by agents, Aug 20 → Sep 23. Across 23,914 runs: **21,706 skipped (90.8%) · 2,163 completed · 45 failed.**

| id | cron | pre-run | runs | Note |
|---|---|---|---|---|
| 26 | `*/30` | **none** | 2,005 ok / 15 fail | b20-heartbeat into one thread → `ses_fe99e9c80ffe…`, $6.4k notional, context ~968k. **93% of all agent runs.** Fails: 7× "Timed out waiting for scheduled session to start", 6× Overloaded, 2× Aborted |
| 27 / 32 / 38 | 30m / 15m / 1h | notify-only scripts that "always exit non-zero" | 2,079 / 4,126 / 1,000 skipped, 0 ok | The pre-run *is* the job; Kimaki only logs skips |
| 47 / 48 / 58 | `*/10` | abuse / blocklist / boot-health | 4,658 / 4,654 / 1,489 skipped; 1 / 4 / 5 woke | Gate works: 99.8% skip |
| 49 | `17 *` | dnssec-check | 783 skipped, 0 woke | |
| 51 | `30 8 * * *` | none | 28 ok / 2 aborted | Daily into one thread (`ses_fb35bcab3ffe…`, $3.3k) |
| 5 | weekly | none | 6 ok | Pinned `claude-sonnet-5` (the only task with an explicit model) |
| 59 | `0 7 * * *` | deal-hunter `hunt.ts --browser` | **5/5 skipped** | Has never woken an agent; check whether that's intended |
| 21, 23 | `at` | none | pending | Personal reminders (Hinge/Tinder 11-21, Gymbox 10-19) |

Cancelled history:
- Orchestrator loops (28–31): `*/5` and `*/10`, lived about 3 h on Aug 20, 8 aborted.
- Doomsday loops (37, 41, 44): 7 + 2 aborted.
- Supervision (42), advanced-hook and launcher loops (17, 20). All short-lived, from Jul 30 to Aug 28.

**Failure causes:** "Aborted" 30 of 45, because the owner typed into the scheduled thread mid-run; "Timed out waiting for scheduled session to start" 10; "Overloaded" 6.

---

## 5. Top 10 things tooling could do for him

| # | Proposal | Evidence | Layer | Effort | Upstream vs fork |
|---|---|---|---|---|---|
| 1 | **Model pinning that survives `kimaki send`.** A thread-level "lock model" flag; dispatches with no `--model` inherit the target thread's pin, never the global default or the sender's model. Warn when a send would change a pinned model. Also auto-migrate stale channel pins when a model is deprecated. | 532 switches, 112/171 footers with no model, the 08-20 and 09-03 rants | Kimaki-native | M | Upstream PR (generic bug/UX) |
| 2 | **Interrupt → queue by default for the owner, plus a "steer" mode.** Messages sent while busy get queued, or injected at the next tool boundary, instead of aborting. A visible "queued (n)" reaction. | 4,713 self-aborts; prefill errors on resume (94) | Kimaki-native | M | Upstream (setting) |
| 3 | **Auto-continue and a stall watchdog.** If a turn ends without a completion marker or todo list done, or the session idles while a todo is open, auto-send "continue", with a capped retry count. Detect "assistant-prefill" and abort-resume states and repair them. | 499 proceed/continue nudges, 358 "?"/status probes, 18 "why did you stop", 39 stuck | Kimaki-native | M | Fork first, upstream later |
| 4 | **Rolling handoff instead of 1M-context mega-threads.** At ~60% context, or when compaction count is 3 or more, auto-create a "(handoff #n)" thread with a structured brief, link both ways, and preserve the model pin. Scheduled tasks should default to *fresh session per run* (or a `--max-context` rotate). | 38 sessions >800k, 102 compactions in one thread, task-26 $6.4k thread, 175 handoff messages | Kimaki-native | M | Upstream (task option) + fork (brief format) |
| 5 | **Cross-thread dashboard and status digest.** One message or command listing every active thread: busy/idle/waiting-question/error, model, context %, last line. Replaces "?" and "tend to the threads" / "sync". It could also be a spoken summary. | 9 threads/day median, 147 status probes in 60 d, 76 unanswered questions | **Both** (Kimaki data, Wendy voice) | M | Fork (owner-specific), digest command upstreamable |
| 6 | **Content-filter recovery.** On `ContentFilterError`: retry once with a reframing system note, then offer buttons for "switch to gpt-5.6-sol" or "fork a sanitized context". Track per-thread filter counts. | 204 blocks (139 in 60 d), a manual "unblocking a stuck agent thread" session | Kimaki-native | S–M | Fork (provider- and use-specific) |
| 7 | **Owner-reply macros and better default buttons.** After every completed turn, show sticky buttons: Continue / Commit & push / Status / Hand off. Add short aliases (`.p`, `.cp`). | 508 clicks already; commit/push typed 308×; proceed 186× | Kimaki-native | S | Upstream |
| 8 | **Scheduled-task hygiene.** Show a skip/wake ratio and cost per task in `task list`; alert when a task has 0 wakes after N runs (task 59) or always-skips by design (27/32/38 should be marked `notifyOnly`); prune 1/s skip logging; set `allowConcurrency=false` with "owner typing" deferral instead of aborting. | 21,706 skips, 30 aborts, 10 start timeouts | Kimaki-native | S | Upstream |
| 9 | **Voice-first nudges via Wendy.** "Wendy, tell BaseStonk to keep pushing", "what's stuck?", "hand the bridge thread to fable". Map voice intents to `kimaki send` / queue / status, so the 37% of messages that are short nudges become hands-free. Also covers "boot wendy" / "retranscribe". | 7,116 short messages; overnight activity; 31 retranscribe and 15 wake messages | Wendy | M–L | Fork-only |
| 10 | **Personal-log side channel.** Route macro and food logging and life reminders to a lightweight structured tracker (Wendy skill or tiny DB) instead of a 2.6k-turn, 970k-context Opus thread (`ses_35e3860b2ffe…`, $3.6k notional, 20 compactions). | 341 food lines; Gymbox/Hinge `at` tasks | Wendy (+ Kimaki task) | S–M | Fork-only |

Honourable mentions:
- Image downscaling before send: about 50 historical 2000px errors, now fixed.
- Tone down the `openai-rotation` log spam.
- A "read-only peer" mode for spawning auditors that can't block a builder thread. He typed this constraint 59×.

---

## Appendix A: SQL and commands run

```sql
-- schema
.schema session / .schema message / .schema part / .indexes
-- volume
select count(*), sum(parent_id is null), min(datetime(time_created/1000,'unixepoch')), max(...) from session;
select strftime('%Y-%m',time_created/1000,'unixepoch') m, count(*), sum(parent_id is null) from session group by m;
select directory, count(*), sum(parent_id is null) from session where time_created > (strftime('%s','now')-60*86400)*1000 group by directory order by 2 desc limit 30;
select directory,count(*) from session where time_created between 1775000000000 and 1780000000000 group by 1 order by 2 desc limit 8;
select substr(title,1,80),count(*) from session where time_created between 1775000000000 and 1780000000000 group by 1 order by 2 desc limit 8;  -- CLARITY batch
-- kimaki db
select strftime('%Y-%m',created_at) m, source, count(*), sum(parent_session_id is not null) from thread_sessions group by m, source;
select model_id, variant, count(*) from session_models group by 1,2 order by 3 desc;
select agent_name, count(*) from session_agents group by 1;
select id,status,schedule_kind,cron_expr,attempts,substr(last_error,1,80),substr(prompt_preview,1,70),created_at,last_run_at from scheduled_tasks order by id;
select scheduled_task_id, status, count(*), min(started_at), max(started_at) from scheduled_task_runs group by 1,2;
select scheduled_task_id, count(distinct session_id), count(distinct thread_id), sum(session_id is null) from scheduled_task_runs group by 1;
select scheduled_task_id, status, substr(error,1,160), count(*) from scheduled_task_runs where error is not null group by 1,2,3 order by 4 desc;
select type,status,count(*) from ipc_requests group by 1,2;
select json_extract(event_json,'$.type') t,count(*) from session_events group by t order by 2 desc;
select session_id,wake_at,status,attempts,substr(reason,1,80) from session_sleeps;
with a as (select session_id, json_extract(event_json,'$.properties.id') qid from session_events where json_extract(event_json,'$.type')='question.asked' group by 1,2),
     r as (select json_extract(event_json,'$.properties.requestID') qid from session_events where json_extract(event_json,'$.type') in ('question.replied','question.rejected'))
select count(*), count(distinct session_id) from a where qid not in (select qid from r where qid is not null);
select substr(json_extract(event_json,'$.properties.error.data.message'),1,70), json_extract(event_json,'$.properties.error.name'), count(*) from session_events where json_extract(event_json,'$.type')='session.error' group by 1,2 order by 3 desc;
select model_id,variant,updated_at from global_models;
select c.channel_id,d.directory,c.model_id,c.variant from channel_models c join channel_directories d using(channel_id);
```

Per-session extraction (Python, `mode=ro`, indexed lookups only), run over the 934 ids:
```sql
select ... from session where id=?;
select id,time_created,data from message where session_id=? order by time_created;   -- role, model, agent, tokens, error, finish, summary
select data from part where message_id=?;                                            -- only for role=user: text / synthetic / file
```
Commands: `kimaki task list`, `kimaki session list --json` (returns only the cwd project), plus `tail` of `~/.kimaki/kimaki.log` and `restart.log`.

Scripts are in `/tmp/opencode/l3/` (`extract.py`, `classify.py`, `clusters.py`). Their intermediate outputs are `user_msgs.jsonl`, `sessions.jsonl` and `U.json`.

Caveats:
- `session_events` may be pruned, so question and error counts are lower bounds.
- Cost is notional (OAuth plans).
- Regex clusters overlap a little.
- Scheduled thread prompts appear under the owner's id and were separated by prompt matching. A few owner messages that quote a task prompt could be misclassified.
