---
'kimaki': patch
---

**The Kimaki OpenCode plugin loads again.** A merge brought back a call to `registerMainmastCompaction`, which no longer exists, so the plugin failed to load and every session reported "Kimaki plugin is not active in OpenCode". The plugin now registers the mainmast timers again.
