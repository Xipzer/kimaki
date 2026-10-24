---
'kimaki': patch
---

Skip the footer after a turn that posted nothing visible. When the agent writes no text and its tool lines are all hidden (read-only tools at the default verbosity), Discord no longer shows a footer for that turn. Two footers in a row, for example after a woken mainmast answered with nothing, are gone.

```
-# *kimakivoice ⋅ main ⋅ 15s ⋅ 17% ⋅ claude-opus-5-5 ⋅ opus*
-# *kimakivoice ⋅ main ⋅ 15s ⋅ 17% ⋅ claude-opus-5-5 ⋅ opus*   <- no longer posted
```

The same rule applies to the silent footer between queued messages of one execution.
