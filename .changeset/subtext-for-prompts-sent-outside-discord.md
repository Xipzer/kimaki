---
'kimaki': patch
---

Show every prompt the bot posts in a thread as grey subtext, so it reads apart from model output. This covers `kimaki send` prompts, routines, OpenCode TUI prompts, voice messages and voice calls, `/new-session`, `/<agent>-agent` and the replies of `/queue` and other slash commands.

```
-# » **CLI:** Run the tests and fix failures
-# » **routine #2:** Hourly report
```

Subtext only renders inline markdown, so multi-line prompts get `-# ` on every line, headings become bold, and code blocks stay as normal code blocks. A code block at the start of a prompt begins on the line below the `» **name:**` prefix, so Discord formats it:

````
-# » **CLI:**
-# **Release plan**
-# - step one
```ts
const version = '1.2.0'
```
````
