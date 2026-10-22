---
'kimaki': patch
---

`kimaki tunnel` works with Vite again without `server.allowedHosts`.

opentunnel forwards the raw request, so the app saw `Host: <name>.<id>.opentunnel.xyz`. Vite rejects unknown hosts with `403 Blocked request` (DNS rebinding protection). Kimaki now sends requests through a small loopback proxy that sets `Host: localhost:<port>`, like traforo did in Kimaki 0.x. Vite HMR WebSockets go through the proxy too.

The public host is still available to the app:

```
Host:              localhost:5173
X-Forwarded-Host:  my-app.<id>.opentunnel.xyz
X-Forwarded-Proto: https
```

You can remove `allowedHosts: ['.opentunnel.xyz']` from your Vite config.
