---
'kimaki': patch
---

`kimaki tunnel -t <id>` now fails at once when another process already serves that tunnel ID, instead of waiting 60 seconds:

```
Tunnel ID my-app is already used by another process. Pass a different -t
```

It uses `@opentunnel/client` 0.6.0, which can fail fast on route conflicts. The "getting a certificate" message now also shows when an existing tunnel renews its certificate, not only on the first run.
