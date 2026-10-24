---
'kimaki': minor
'website': patch
---

Add **mainmast** channels, the new default. A project channel is now a chat with one long session: you write in the channel, it answers in the channel, and it starts a thread for each piece of work.

```
#my-app
  you: fix the flaky login test
  Started a worker for the flaky login test.
  Fixed in #fix-flaky-login-test: the test now awaits the session cookie.
```

- The mainmast starts workers in the background and says in one line what it started. When a worker run ends, its final answer wakes the mainmast, which reports the outcome with one link to the thread. Kimaki posts no other finish notice.
- For related work that needs the same context, the mainmast can fork a worker or a past session with `kimaki send --thread <id> --prompt '... btw' --parent-session <mainmast>`, when the fork touches different files. `--parent-session` now also applies to btw forks, so the fork wakes the mainmast when it ends, like any worker.
- Worker threads do not join your sidebar unless you ask to follow one, or the work is planning or long work you will probably take part in. You can still open and steer any worker thread.
- With `kimaki send --wait` the sender gets the answer in the command output instead: a run whose prompt came from `--wait` sends no note while its sender still runs, so the result is never reported twice. Other threads of the channel and routines leave a silent note for the next prompt.
- The mainmast reads files and the repo source itself to understand the project, and delegates edits, builds, tests, long debugging and big research, so its context stays clean across many compactions. It writes short worker prompts as bullet lists without headings, in the style of its replies. Every worker is a visible thread you can talk to. The mainmast uses the `subagent` tool only for quick throwaway lookups.
- Workers read the mainmast session for project context. The mainmast keeps memory in a tracked `MEMORY.md`, read through its headings.
- Halfway through the OpenCode `warming` window (30 minutes without warming) an idle mainmast is asked for useful work. With warming on, it is compacted when the window ends, while the cache is still warm.
- The mainmast and worker instructions come from the Kimaki OpenCode plugin. After a Kimaki upgrade, an existing mainmast or worker gets the new instructions at its next message, added after the history, so the prompt cache stays warm.
- `/new-mainmast` starts a fresh mainmast in the channel.
- Onboarding answers in the `#kimaki` channel instead of a thread.
- `kimaki session read <id>` now prints only prompts and final answers. Use `--full` for every tool call. `kimaki session wait` and `kimaki send --wait` print the same short output.

Start Kimaki with `--no-mainmast` to keep one new thread per channel message.
