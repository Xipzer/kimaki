---
'kimaki': minor
---

Add `kimaki session recover <sessionId>` to retry a turn that ended in a provider or content-filter error.

It reverts only the failed assistant messages, never a successful step, and resends through the Discord thread on the same agent and model. When the whole turn failed, the original user prompt is replayed; when earlier steps of the turn succeeded, the agent is asked to continue. `--prompt` sends a different prompt, and `--dry-run` prints the plan without changing anything. Idle, healthy sessions are left alone.
