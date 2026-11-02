---
'kimaki': patch
---

**Agents no longer lose their answer when they end a turn with `kimaki sleep` or `kimaki buttons`.** The instructions told agents to write all text first and run these commands last. Models (seen with Claude Opus at high reasoning effort) sometimes plan that text only in their hidden reasoning and then call the command, so the user never sees the answer, and the sleep result then told them to reply with one short line and stop. Agents now run `kimaki sleep` and `kimaki buttons` first and write their answer after them, and the sleep result reminds them to give the full answer before the waiting line. `kimaki upload-request` keeps its text-first rule because it blocks until the user uploads.
