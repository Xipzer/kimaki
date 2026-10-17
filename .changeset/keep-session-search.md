---
'kimaki': minor
---

**`kimaki session search <query>` is back.** It searches session titles and then message content, newest first, by project, `--channel`, or `--all`, limited by `--days` (default 14, `0` for all time). `/pattern/flags` searches with a regular expression and `--json` prints the matching sessions. Scripts and assistants that call it keep working; `kimaki session sync` + `rg` remains the faster way to search large histories.
