---
'kimaki': minor
---

`/new-session` no longer needs a prompt. Without one it creates an empty thread and the agent does not start. The first message you send in that thread starts the session, with the agent (and its model) picked in the command:

```
/new-session agent:plan
```

Attaching `files` still needs a prompt.
