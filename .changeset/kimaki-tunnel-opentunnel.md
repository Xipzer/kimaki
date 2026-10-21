---
'kimaki': minor
---

`kimaki tunnel` now uses [opentunnel.xyz](https://opentunnel.xyz) instead of traforo. TLS ends on your machine, so the relay never sees the traffic.

```bash
kimaki tunnel -- pnpm dev
# Local:  http://localhost:5173
# Tunnel: https://3f9c2a71d04be6e8.7bnpwpr25iaa.opentunnel.xyz
```

- URLs are now `https://<name>.<machine id>.opentunnel.xyz`. `-t <name>` sets a fixed name.
- The child process gets `KIMAKI_TUNNEL_URL`. `TRAFORO_URL` is still set to the same URL, so existing setups keep working:

  ```bash
  kimaki tunnel -- sh -c 'BETTER_AUTH_URL=$KIMAKI_TUNNEL_URL exec pnpm dev'
  ```

- The first run on a machine creates its tunnel and waits up to a minute for a certificate. The identity is shared with the `opentunnel` CLI (`~/.local/share/opentunnel/default`).
- Vite rejects unknown `Host` headers: set `server.allowedHosts: ['.opentunnel.xyz']`.
