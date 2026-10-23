---
'kimaki': patch
---

Write more of each session into the searchable transcripts (`<data-dir>/transcripts/<session id>.md`).

- Thinking text is now included.
- Tool inputs keep up to 5000 chars instead of 500, so full edits, shell commands and subagent prompts are searchable.
- Compaction summaries, synthetic and system messages are written as readable text instead of raw JSON.
- Tool outputs stay out, to keep the files small and `rg` results clean.

`kimaki session read` keeps its compact default. Run this once to write old transcripts again in the new format:

```bash
kimaki session sync --all --rebuild
```
