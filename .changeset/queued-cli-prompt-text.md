---
'kimaki': patch
---

Show the queued text when `kimaki send --thread ... . queue` (or a routine, or the OpenCode TUI) queues a prompt into a busy thread. Before, the thread only showed `Queued at position 1` and later `Queued message sent`, with no hint of what was queued.

Now the queue notice holds the prompt as subtext, and when the prompt starts running a short reply to that notice marks the moment, so the text is not posted twice:

```
-# » **CLI:** Run the tests after your current work
-# Queued at position 1. Remove it with /clear-queue position:1
...
↳ -# Queued message sent
```

Long prompts are cut to fit one Discord message. Queued Discord messages work as before: the notice replies to the user's message. A `/queue-command` notice now also replies to its `» user: /command` line.
