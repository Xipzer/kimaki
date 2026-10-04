---
'kimaki': patch
---

Keep slash commands registered by other integrations that share the bot application. On startup Kimaki now fetches the existing guild commands and only replaces the ones it owns (its current commands, `-agent`/`-cmd`/`-skill`/`-mcp-prompt` dynamic commands, and commands from older Kimaki versions), sending the rest back unchanged. They count toward Discord's 100-command limit, so Kimaki drops its own lowest-priority dynamic commands first. Set `KIMAKI_PRESERVE_COMMANDS=name,prefix-*` to keep foreign commands whose names look like Kimaki's dynamic patterns.
