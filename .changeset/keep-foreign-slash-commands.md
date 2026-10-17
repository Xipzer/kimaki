---
'kimaki': minor
'discord-digital-twin': patch
---

**Slash commands of other apps on the same Discord application are kept.** Kimaki used to replace the whole guild command list on every start and catalog change, deleting commands another process registered with the same bot token (for example `/wendy` and `/whisper-*`). Kimaki now reads the guild's commands first and sends back the ones it does not own; its own stale commands are still removed. When the 100-command limit is reached, Kimaki's catalog shortcuts make room first. `KIMAKI_PRESERVE_COMMANDS=name,prefix-*` keeps look-alike names that would otherwise count as Kimaki's.

`discord-digital-twin` serves `GET /applications/:id/guilds/:id/commands`, so bots can read their registered guild commands.
