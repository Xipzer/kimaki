---
'kimaki': patch
---

Show the `prompt cache miss` line in Discord only when a step wrote at least 50% of its prompt to the cache. Smaller cache drops are usually not a full cache loss, so they no longer post a notice.
