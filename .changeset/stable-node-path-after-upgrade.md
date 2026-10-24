---
'kimaki': patch
---

Keep the `kimaki` command working in agent shells after a Node upgrade while the bot runs.

The `~/.kimaki/bin/kimaki` shim, `autostart.command` and the `kimaki restart` respawn used the resolved Node binary, for example `/home/linuxbrew/.linuxbrew/Cellar/node/26.12.0/bin/node`. `brew upgrade node` deletes that folder, so every agent `kimaki` call failed with `node: not found`. Kimaki now uses the `node` on `PATH` that links to the same binary, for example `/home/linuxbrew/.linuxbrew/bin/node`, which follows upgrades.

Fixes #242
