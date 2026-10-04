# Tailored Kimaki: synthesis

Inputs: four independent lens reports in this folder.

- `lens1-voice.md`: voice conversations with Wendy (diagnostics, 15 days)
- `lens2-tool-traffic.md`: Wendy <-> Kimaki tool traffic
- `lens3-direct-usage.md`: direct Kimaki usage from opencode.db and the Kimaki DB
- `lens4-friction-log.md`: builder-thread incidents (56 incidents, Jul–Oct)

The synthesising session checked two claims against the 0.31 source:

- **Model reset.** Any prompt that carries an agent runs `setSessionAgent` + `clearSessionModel`. See `thread-session-runtime.ts`, around lines 3470 and 4545 on upstream `5daef11e`. Kimaki's own system prompt tells agents to always pass `--agent` to `kimaki send`. So agent-to-agent follow-ups wipe a thread's pinned model, and it falls back to the channel or global default. This reconciles lens 2 ("omitting `--model` is harmless") with lens 3 (model drift in at least 8 threads, 532 in-session model switches).
- **Stdout flush.** `kimaki session read` calls `process.stdout.write(result)` and then `process.exit(0)` (`cli-commands/session.ts:448,484`). With a pipe, a large result can be cut off.

## Ranked opportunities

| # | Problem | Evidence | Change | Where | Impact | Effort | Route |
|---|---|---|---|---|---|---|---|
| 1 | Thread model silently resets | L3: 75 model-pin arguments, 8+ threads, ALL-CAPS complaints; 112/171 agent dispatches without a model. L4: pin war. Source: `--agent` clears the model | Don't clear the model when the agent is unchanged; add a `session model get/set/lock` CLI; resolve "opus" to the newest version | Kimaki | High: removes the angriest recurring fight and Wendy's SQL pin writer | S–M | Fix upstream, lock fork-first |
| 2 | Nobody can see that a thread is blocked or errored | L1: Wendy said a stuck thread was "working" (09-30 00:12), the owner repeated "how are you not seeing that?" about 6 times. L3: 204 content-filter blocks, 94 prefill errors. L2: Wendy scans the 93 GB DB every 60 s | `kimaki session status --json`: idle/working/blocked/errored, last error, model, context %, last reply. Same fields in `session list --json` | Kimaki | High: replaces 101 calls across 24 status chains and the DB scraper | M | Upstream |
| 3 | Recovering from content-filter or provider errors is manual and flaky | L1: 51 auto-unblock attempts on one thread, 28 failed. L4: guard took ~10 commits in 3 days, one run wiped 30 min of work. L3: 94 "assistant prefill not supported" after aborts | `kimaki session recover`: revert the failed turn, resend on the same model, bounded retries; optional auto-mode per thread | Kimaki + Wendy voice action | High | M | Fork first |
| 4 | `session read` output is stale or truncated, and there's no structured read | L2: 86/110 `read_session` results were stale (also a Wendy parser bug), `fetch_reply` 0/10. L4: stdout cut off in pipes | Flush before exit; `session read --json --last N --since <msgId>` including message errors | Kimaki (+ Wendy parser fix) | High for Wendy accuracy | S | Upstream |
| 5 | Typing mid-turn aborts work | L3: 5,824 aborted turns, 81% from a new message; 30 of 45 scheduled-task failures were the owner typing mid-run | Per-channel default "queue/steer" instead of interrupt, or an explicit `!` prefix to interrupt | Kimaki | High (lost work and tokens) | M | Upstream (config option) |
| 6 | Voice transcription breaks on every upgrade | L4: about 40 turns, regressed in 0.30.1 and 0.31.0, regex patch on every launch | **Done on `tailored/main`**: `OPENAI_BASE_URL` honoured. Next: stored endpoint setting, health check, visible error | Kimaki | Med-High | S | Upstream PR |
| 7 | Kimaki restarts wipe Wendy's slash commands | L4: bulk PUT of guild commands, Wendy re-registers every 6 h and checks every 10 min | Merge instead of overwrite (keep other apps' and other prefixes' commands) | Kimaki | Med | S | Upstream |
| 8 | Events queued into every thread runtime | L4: thread bricking; PR #181 open since Aug | **Done on `tailored/main`** (cherry-picked with tests) | Kimaki | Med | S | Upstream (already a PR) |
| 9 | Polling instead of events | L1: 101 s index rebuild every 10 min, 3,699 errors. L2: 45 CLI calls per refresh | `session list --since`, then a local event stream (turn finished/errored/blocked/question) | Both | Med-High: cuts latency and CPU | M–L | Fork first |
| 10 | Multi-step voice chains are slow | L1: median 5 s for one step vs 30–39 s for 3+; p90 48 s. `ask_thread` timeout in 57% of calls | `send --json` returns ids at once, plus `session wait --after <msg> --timeout`; Wendy one-call "resolve+status" and "resolve+send" | Both | Med-High for voice UX | S–M | Upstream for the CLI parts |
| 11 | Finding threads by spoken name is unreliable | L1: wrong-thread send (10-01 10:43), 6 sessions for 3 tasks (09-22). L2: `search_sessions` 0/7 hits | `kimaki session resolve "<name>"` ranked matches; Wendy uses the existing `--all/--json` flags | Both | Med | S–M | Upstream |
| 12 | Long-lived threads and scheduled-task bloat | L3: 38 sessions >800k context, one compacted 102 times; task 26 = 93% of agent runs, $6.4k notional, never fresh | Auto-handoff to a fresh thread at a context threshold; option to give each scheduled run a fresh session; per-task cost and skip stats | Kimaki | Med (cost, quality) | M | Upstream + fork |
| 13 | Repetitive short commands | L3: 499 "proceed/go", 308 "commit and push", 358 "?" status | Persistent Continue / Commit & push / Status buttons on the final footer | Kimaki | Low-Med | S | Upstream |
| 14 | Wendy-only accuracy gaps | L1: claimed actions that hadn't happened, commitments firing on any movement, 53/70 barge-ins with no words. L2: broken transcript parser | Fix the parser and take the tail, report actions only after they happen, fire commitments on completion, tune barge-in | Wendy | High for trust | S–M | n/a |
| 15 | Noisy logs | 35k-char WARN lines per step (owner screenshot 10-02) | **Done on `tailored/main`**: JSON attributes compacted to counts | Kimaki | Low | S | Upstream |

## Recommended first milestone

1. **Model stickiness (#1).** Stop `--agent` from clearing the model when the agent is unchanged; add `kimaki session model get|set [--lock]`.
2. **Observable sessions (#2 + #4).** `session status --json`, flush fix, `session read --json --last/--since` with error parts.
3. **Native recovery (#3).** `kimaki session recover <id>`, built on #2's blocked/errored state.
4. **Keep other apps' commands (#7).**
5. **Wendy quick wins (#14, #11 Wendy side, the scan part of #9).** Fix the transcript parser, use `--all/--json/--project`, drop the 60 s full-DB scan, and move her to the new status and model APIs once 1–2 land.

Items 1, 2, 4 and the CLI parts of 3 are small and fit upstream. Each should go out as a PR as well as landing on `tailored/main`.

## Does this justify the rename and a long-lived fork?

**A long-lived fork: yes.** The owner already carries 4 patches. The event-scope fix PR has been open about 2 months. Items 3, 9 and the model lock are opinionated and may never land upstream. Upstream is also heading toward an OpenCode v2 plugin rewrite on its own schedule.

**The rename: not yet.** Of 15 opportunities, about 10 are upstream-friendly and only 4–5 are fork-only. A rename adds about 2,500 identifier changes and a data-folder migration, and makes every upstream cherry-pick conflict. Rename once production runs from the fork and the fork-only features (recover, lock, event stream, Wendy hooks) have shipped and proven themselves.
