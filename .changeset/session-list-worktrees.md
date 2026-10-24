---
'kimaki': patch
---

`kimaki session list` (and `--active`) now includes sessions running in linked worktrees of the same project. Before, it matched only the exact directory, so an agent waiting for active sessions with `kimaki session list --active` stopped waiting while worktree sessions were still busy.
