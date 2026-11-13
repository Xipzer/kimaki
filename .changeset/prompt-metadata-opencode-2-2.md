---
'kimaki': patch
---

**Per-message context works again on OpenCode 2.2.x.** OpenCode 2.2 passes messages to plugin request hooks without the metadata their prompt was stored with, so the `<discord-user>` line (who wrote the message, thread title, attachments) and the "time since your last message" line were silently missing from every request. Kimaki now reads the metadata from the session history by message ID, once per new prompt. OpenCode 2.3.0 passes it again; this lookup is only used when it is absent.
