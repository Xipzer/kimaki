---
'kimaki': minor
---

**`/context-usage` shows whether the session is still working.** It adds a status line derived from OpenCode's message timestamps: how long the current run has been going, how long the model has been thinking in its current reasoning block, and when anything last happened (`**Last activity:** 2s ago, shell`). When idle it shows when the last run ended, and it says when the last prompt has no reply yet. Use it when a thread shows only the typing indicator for a long time.

Fixes #253
