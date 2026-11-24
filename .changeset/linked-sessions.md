---
'kimaki': minor
---

**Linked sessions survive compaction.** Sessions that talk to each other keep a two-way link, and each sees its most recent liaisons (up to 8, with thread, session ID and last contact) in a session instruction entry, so a specialist does not forget its partners when its history is compacted. Links are recorded when a session runs `kimaki send --thread/--session`, when a session is started with `--parent-session`, and when a prompt names a session ID or a Kimaki thread. `kimaki session links [--add <id>] [--remove <id>]` lists and edits them. Stored in the `session_links` table (one row per direction).

**Across machines.** `kimaki send --host <ssh alias> --thread <id> ...` runs the send on the machine that serves the thread and names the sending session there (`--from-session`, `--from-thread`, `--from-machine`), so both sides link. The receiving session sees `-# from <machine> · thread <id> · session <id>` under the prompt, and remote envelopes between machines on the same bot carry the same fields. `session_links` gains `linked_thread_id`, `linked_machine` and `linked_title`; a thread whose session is not known yet is linked as `thread:<id>` until it is.
