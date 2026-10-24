---
'kimaki': patch
---

Start `kimaki send` sessions about 3x faster. The model now starts right after the Discord thread exists, instead of waiting for extra Discord round trips:

- users from `--user` are added to the thread in the background
- the `» **CLI:** prompt` line is posted in the background, still before the session output
- a new session is prompted directly, without the interrupt call a busy session needs

With ~300 ms per Discord request, the time from `kimaki send` to the first model step drops from about 1.0 s to 0.4 s, and the command returns at the same time. `kimaki send --thread` with `--user` no longer waits for the member add either (about 350 ms to 50 ms).
