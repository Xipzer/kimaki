---
'kimaki': minor
---

Keep a thread's model when a prompt repeats the session's current agent, and add `kimaki session model` to show, pin and lock it.

Prompts that carry an agent (for example `kimaki send --session ses_xxx --agent build`) used to clear the session model every time, so agent-to-agent follow-ups silently fell back to the channel or global model. The session model is now cleared only when the agent actually changes.

`kimaki session model <sessionId>` prints the pinned model, variant and lock state (`--json` for machines). `--set provider/model [--variant v]` pins a model, validated against the session's OpenCode providers. `--lock` keeps the model across agent switches and makes a per-prompt `kimaki send --model` print a warning and keep the locked model; `--unlock` removes the lock.
