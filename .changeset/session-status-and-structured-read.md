---
'kimaki': minor
---

Add `kimaki session status <sessionId>` and `kimaki session read --json` so scripts can see when a thread is stuck.

`session status` reports `idle`, `working`, `question`, `blocked` (the last assistant message was refused by a provider content or safety filter) or `errored` (any other provider error), plus the last error, agent, model, pinned session model, context tokens, the last reply and the Discord thread id. Add `--json` for structured output.

`session read --json [--last N] [--since <messageId>]` returns structured messages with ids, role, time, agent, model, text, tool summaries and the message-level error. The markdown output of `session read` now shows assistant message errors such as `ContentFilterError` too. `session list --json` gains `state` and `lastError` fields.

`session read`, `status` and the other session commands now also find a session through its Kimaki thread's project before scanning every project.
