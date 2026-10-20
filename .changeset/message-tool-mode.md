---
'kimaki': minor
'website': patch
---

Add `kimaki --message-tool`, an opt-in mode where Discord shows only a concise reply the agent sends with a `send_message` tool. It is off by default.

```bash
kimaki --message-tool
```

The agent still writes its normal text, so the same session stays fully readable in the OpenCode TUI. It then repeats a short markdown version with `send_message`, and only that reaches Discord. Threads skip "I'll read the file" narration and show only real updates and results.

```
model text             ──▶ OpenCode TUI (hidden in Discord)
send_message({ text }) ──▶ Discord message, rendered as markdown
```

- Only root sessions of the thread get the tool. Subagents and your own OpenCode TUI sessions never see it.
- The tool list and the extra system text stay the same for the whole session, so the prompt cache keeps hitting.
- If a turn ends without any `send_message` call, Kimaki posts the last plain text anyway, so you never get a silent turn.
- Running sessions pick up the mode on the next bot start or message. Autostart and `kimaki restart` keep the flag.
