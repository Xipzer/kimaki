---
'kimaki': patch
---

**A session keeps its model when a message names its current agent again.** Agents pass `--agent <current_agent>` on every `kimaki send`, and an agent with its own configured model used to switch the thread back to that model, dropping one chosen with `/model`. Now only a different agent, an explicit `/agent` pick, or `--model` changes it. `kimaki send --session ... --model X --agent Y` also keeps `X` instead of letting `Y`'s configured model replace it.

Fixes #245
Closes #249
Contributed by [@Xipzer](https://github.com/Xipzer) in #249.
