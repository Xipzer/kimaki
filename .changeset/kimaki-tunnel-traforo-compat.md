---
'kimaki': patch
---

`kimaki tunnel` accepts traforo-style tunnel IDs again and supports `--kill` on Windows.

- `-t` names and tuistory session IDs are mapped to a valid subdomain instead of failing. `-t My_App` gives `https://my-app.<id>.opentunnel.xyz`. Before, a tuistory session like `Holocron_Dev` got a random URL on every restart; now it keeps `holocron-dev`.
- `--kill` finds the process on the port with `netstat` on Windows, like traforo did. macOS and Linux still use `lsof`.
