---
'kimaki': patch
---

**Routines and new sessions no longer fail with "Agent `build` is not available" on an idle project.** A project OpenCode has not loaded yet lists no agents for a moment after it answers, and on OpenCode 2.2.7 `integration.list` no longer waits for that. Kimaki took the empty list as final, so the first routine, `kimaki send --agent` or voice message in an idle project failed. Kimaki now asks again for up to 5 seconds while the list is empty or lacks the requested agent (2 seconds in autocomplete). The slash command catalog waits the same way.
