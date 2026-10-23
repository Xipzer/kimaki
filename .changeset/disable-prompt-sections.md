---
'kimaki': minor
---

Add `--disable-prompt <section>` to remove static parts of the Kimaki system prompt from new sessions. Repeat the flag or pass a comma separated list:

```bash
kimaki --disable-prompt critique-diffs --disable-prompt discord-callouts
kimaki --disable-prompt markdown-formatting,ascii-diagrams,search-result-urls
```

Sections: `discord-permissions`, `kimaki-debugging`, `file-upload-requests`, `action-buttons`, `session-sleep`, `session-abort`, `cross-project-commands`, `waiting-sessions`, `critique-diffs`, `markdown-formatting`, `discord-callouts`, `search-result-urls`, `ascii-diagrams`. `kimaki --help` lists them. Use it to drop rules you replace with your own AGENTS.md, for example a different diff tool than critique. Existing sessions keep their prompt.

The tunnel hint moves out of the system prompt into the `kimaki-tunnel` skill description, so `--disable-skills kimaki-tunnel` now removes all tunnel instructions.
