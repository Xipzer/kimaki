---
'kimaki': minor
---

**Long reasoning shows a live status line.** At high thinking levels a thread used to show only the typing indicator for 25–70 s before the first output. When a reasoning block runs longer than 4 s, Kimaki now posts `-# thinking · 12s · <latest summary heading>` and updates it every 5 s, also for models that stream no reasoning summary. Before the answer it becomes `-# thought for 31s · <heading>`. Short blocks post nothing.

Fixes #247
Contributed by [@Xipzer](https://github.com/Xipzer) in #251.
