---
'kimaki': patch
---

**OAuth accounts can no longer disappear without a trace.** Every removed Anthropic, OpenAI or xAI account (manual or after a permanently rejected refresh token) is first archived to `removed-oauth-accounts.jsonl` next to the account store (mode 0600, restorable) and logged with the reason. Account stores are now written atomically, and a store file that exists but can't be parsed is kept as `*.corrupt-<time>` and reported instead of being read as empty, which previously let the next save wipe every account.
