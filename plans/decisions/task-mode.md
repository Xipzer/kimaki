# Task mode channels (human asked)

- User, 2026-10-24: "use a channel to write text prompts. the agent replies there directly without threads. threads are started for child sessions only instead."
- User, 2026-10-24: "it should have warmup enabled by default to 1 hour. to keep cache warm. and auto compact at end of hour when user is no longer sending prompts."
- User, 2026-10-24: "we default to run all subagents in background so it remains interactive."
- User, 2026-10-24: "we should still show tool calls in main chat for tools calls just like now."
- User, 2026-10-24: "we should still let the user send messages to child agents directly."
- The root session lives in the channel and never ends. Children of the root get their own thread each.
- (agent) Task mode is a SQLite row (`task_channels`) plus `mode` in the session marker. No new in-memory flag: a view whose conversation id equals its channel id is a task root.
- (agent) Warming and idle compaction run in the kimaki plugin, only for marked task roots, because OpenCode warming is global (issue #58163).
- (agent) Subagents run in the parent's directory on the same machine. OpenCode has no child placement yet; other machines go through `kimaki send` plus a relay.
- Why: the main chat stays small and interactive; every piece of work is a thread the user can open.
- Lost: one thread per prompt in that channel (`/new-session` still makes one).
- Open: steer vs interrupt in child threads (plan Task 0 S3).
- Lives in: `plans/task-mode.md` until implemented.
