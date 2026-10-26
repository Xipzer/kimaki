---
'kimaki': patch
---

Show model and agent switches of a session in its Discord thread. When the model, its thinking level or the agent of the main session changes (from `/model`, `/agent`, the OpenCode TUI, or a fallback after a failed run), the thread gets a subtext line:

```
-# Switched model to Claude Opus 5.5 (high)
-# Switched agent from Build to Opus
```

Model names come from the OpenCode model catalog. Subagent switches and the first model of a new session (already in the `using ...` banner) show no line.
