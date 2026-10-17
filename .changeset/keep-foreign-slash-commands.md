---
'kimaki': minor
---

**Slash commands of other apps on the same Discord application are kept.** Kimaki's registration diff deleted every guild command it did not build, including commands another process registered with the same bot token (for example `/assistant` and `/whisper-*`). Kimaki now leaves commands it does not own alone; its own stale commands are still removed. When the 100-command limit is reached, Kimaki's catalog shortcuts make room first. `KIMAKI_PRESERVE_COMMANDS=name,prefix-*` keeps look-alike names that would otherwise count as Kimaki's.
