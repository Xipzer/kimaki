---
'kimaki': minor
'website': patch
---

Add **mainmast** channels, the new default. A project channel is now a chat with one long session: you write in the channel, it answers in the channel, and it starts a thread for each piece of work.

```
#my-app
  you: fix the flaky login test
  Starting a worker for the login test.
  -# ⬦ Fix flaky login test finished: #fix-flaky-login-test
  Fixed in #fix-flaky-login-test: the test now awaits the session cookie.
```

- Threads started with `kimaki send --parent-session <mainmast>` wake the mainmast with their final answer when a run ends. Other threads of the channel and routines leave a silent note for the next prompt.
- The mainmast cannot use the `subagent` tool: every worker is a visible thread you can talk to.
- Kimaki turns on OpenCode prompt cache warming for 1 hour in the global config when no config sets `warming`. Halfway through an idle hour the mainmast is asked for useful work; at the end it is compacted while the cache is still warm.
- Onboarding answers in the `#kimaki` channel instead of a thread.
- `kimaki session read <id>` now prints only prompts and final answers. Use `--full` for every tool call. `kimaki session wait` and `kimaki send --wait` print the same short output.

Start Kimaki with `--no-mainmast` to keep one new thread per channel message.
