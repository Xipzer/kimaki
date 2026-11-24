---
'kimaki': minor
---

**Linked sessions survive compaction.** Sessions that talk to each other keep a two-way link, and each sees its most recent liaisons (up to 8, with thread, session ID and last contact) in a session instruction entry, so a specialist does not forget its partners when its history is compacted. Links are recorded when a session runs `kimaki send --thread/--session`, when a session is started with `--parent-session`, and when a prompt names a session ID or a Kimaki thread. `kimaki session links [--add <id>] [--remove <id>]` lists and edits them. Stored in the `session_links` table (one row per direction).
