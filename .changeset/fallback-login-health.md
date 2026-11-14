---
'@kimaki/plugin-fallback': minor
---

**Saved logins stay usable, and fallback never switches to one that cannot renew.**

1. **Idle logins are kept alive.** A Claude Pro/Max refresh token stops working when it is not used for about two days, so a second account that only exists for fallback was dead by the time it was needed. The plugin now resolves every saved login of the ranked providers once an hour, which refreshes a token that is about to expire. A login whose refresh fails is skipped for a day and marked as needing a new sign-in in OpenCode. When the active login is the dead one and another works, that one becomes active.

2. **A dead login is never activated.** With one account at its limit and the other dead, fallback used to pick the dead one as "the first to recover" and activate it, so every session failed with `Refresh token expired` until someone logged in again. It now waits for the limited account instead.

3. **A model family's weekly cap no longer blocks the whole account.** A rejected subscription request names the limit that was hit (`anthropic-ratelimit-unified-representative-claim`). Only `five_hour`, `seven_day` and `overage` block every model; anything else, or no name, blocks the failed model only, so the session can continue on another model of the same account:

   ```
   fable-5-2 on account A: weekly Fable cap ─▶ fable-5-2 on account B, else opus-5-5 on account A
   ```

New RPC methods next to `blocks`: `keepalive` runs the login check now and returns each login's state (`ok`, `dead`, `unreachable`), `clear` removes blocks (all, or those of `credentialID`). `blocks` also returns when the logins were last checked, and each block the limit it was recorded for.
