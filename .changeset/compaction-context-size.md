---
'kimaki': patch
---

After an automatic compaction the thread now shows the new context size, for example `context compacted to 179k tokens (18%)`. A manual `/compact` still shows `context compacted`, because no model request reads the new context until the next message. Status lines (retries, cache misses, finished subagents and shells, voice call notices) and worktree thread names no longer start with ⬦.
