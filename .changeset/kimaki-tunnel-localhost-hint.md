---
'kimaki': patch
---

`kimaki tunnel` now tells agents to validate with the `Local:` URL. The agent runs on the same machine, so playwriter and curl on localhost are much faster than going through the tunnel. The tunnel URL is for the user.

```
Local:  http://localhost:5173
Tunnel: https://abc.xyz.opentunnel.xyz
Agents: validate with the Local URL (playwriter, curl), it is much faster. The Tunnel URL is for the user.
```

The built-in `kimaki-tunnel` skill says the same.
