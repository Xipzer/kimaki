---
'kimaki': patch
---

Stop opening stray autostart Terminal windows while the bot runs, and add `--no-autostart`.

The OpenCode plugin used to send one `/health` request with a 2 second timeout. When many OpenCode processes started at once, or the bot was busy, the request timed out and the plugin opened `~/.kimaki/autostart.command` although the bot was running. The window only printed `Kimaki already runs on port 29988. Nothing to start.`

The plugin now opens the window only when port 29988 refuses a TCP connection. A running bot accepts the connection even when it is busy, and a timeout no longer counts as "no bot".

Bots run by launchd, systemd or pm2 do not need autostart at all. Pass `--no-autostart` in the service command; Kimaki then deletes `autostart.command` on every start, so the plugin never opens a window:

```bash
kimaki --no-autostart
```

Fixes #243
