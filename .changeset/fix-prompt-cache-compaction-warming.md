---
'kimaki': patch
---

Fix prompt cache misses on compaction and OpenCode `warming` requests.

The Kimaki plugin changed only normal turn requests. It added the session ID system line, the `<discord-user>` context and the Discord `shell` inputs there, but not to compaction or `generate` requests. Those requests then had a different prompt prefix, so the provider wrote the full history to the cache again.

All three request kinds now get the same changes. You can now enable OpenCode session warming in `opencode.json` to keep the Anthropic cache alive between messages:

```json
{ "warming": { "duration": "30 minutes" } }
```
