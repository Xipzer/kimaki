---
'kimaki': patch
---

Fix `kimaki session read`, `session wait`, `send --wait` and `session list/search --json` output getting cut off when stdout is a pipe. The CLI now waits for stdout to flush before exiting.
