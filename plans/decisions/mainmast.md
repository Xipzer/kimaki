# Mainmast channels (human asked)

- User, 2026-10-24: "use a channel to write text prompts. the agent replies there directly without threads."
- User, 2026-10-24: "this will become the new default. users can disable if they want." and "all channels. user can opt out completely via cli flag."
- User, 2026-10-24: "lets use default opencode warm. do the auto summary only for kimaki sessions. only in mainmast mode. lets do it only for mainmast session itself for now."
- User, 2026-10-24: "lets disable the subagent tool then for mainmast" and "only visible threads".
- User, 2026-10-24: "for waking copy what opencode itself does."
- User, 2026-10-24: "automatically tell mainmast agent: user didnt reply ... at 1/2 of the warm time ... if not reply with nothing."
- Every project channel holds one long session (`roots[channelId]`, `thread_sessions` row keyed by the channel ID). `kimaki --no-mainmast` restores one thread per message.
- Workers are `kimaki send` threads, not `subagent` children: they reuse all thread code, work in other projects and worktrees, and users can talk to them. The mainmast session denies `subagent:*`.
- A finished thread run sends the mainmast a synthetic `<session-finished>` item like OpenCode's subagent completion. `resume: true` only when the mainmast started it (`--parent-session`); threads of the channel and routines get `resume: false`.
- Warming is OpenCode's global `warming` config: Kimaki writes `{ "duration": "1 hour" }` once when no config sets the key. A user value wins.
- (agent) The plugin nudges the mainmast at half the warming window after the last user prompt, and compacts it when the window ends if the last request used at least 20% of the context.
- (agent) `kimaki session read` defaults to prompts and final answers; `--full` shows tool calls.
- Why: the coordinator keeps the whole picture in a small context; every piece of work is a visible thread.
- Lost: hidden subagent parallelism in the mainmast; threads per channel message by default.
- Open: per-session warming (opencode#58163); notes from sessions on other machines (TODO in `mainmast.ts`); compacting worker sessions.
- Lives in: `kimaki/src/mainmast.ts`, `kimaki/src/plugin/mainmast.ts`, `kimaki/src/sessions.ts` (`startMainmast`), `kimaki/src/ingress.ts`, `kimaki/src/opencode-server.ts` (`ensureWarming`), `kimaki/src/system-prompt.ts` (`mainmastSection`).
