---
'kimaki': patch
---

Update the Kimaki instructions of existing sessions after a bot restart or upgrade.

Before, a thread or mainmast session kept the instructions it got when it was created, so new CLI commands and prompt fixes never reached it. Now the first message to a session after the bot starts rebuilds its instructions. When the text changed, OpenCode adds only the change after the history, so the prompt cache stays warm. When nothing changed, nothing is sent.
