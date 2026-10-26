---
'kimaki': patch
---

Render prompts that start with block markdown. When a prompt echoed in a thread (`» **CLI:** ...`, `» **user:** ...`, routines, queued prompts) starts with a heading, quote, list, code fence, rule or table, the text now begins on the line below the prefix, so Discord formats it:

```
» **CLI:**
# Release plan
- step one
```
