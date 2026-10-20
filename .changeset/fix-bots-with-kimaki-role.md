---
'kimaki': patch
---

Let other Discord bots with the **Kimaki** role start and continue sessions again, as in 0.31 and as the docs say. This restores multi-agent setups where one bot sends prompts to Kimaki.

- A bot needs the `Kimaki` role. Administrator or Manage Server rights and `--allow-all-users` do not let a bot in, so notifier bots never start sessions by accident.
- The `no-kimaki` role still blocks a bot.
- Webhook messages and Kimaki's own messages are still ignored, except `kimaki send` remote envelopes.

Fixes #240
