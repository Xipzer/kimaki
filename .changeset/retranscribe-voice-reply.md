---
'kimaki': minor
---

**Reply `retranscribe` to a voice message to handle it again.** A voice message sent while the bot was offline, or whose transcription failed, used to be lost: you had to record it again. Now reply to it with the single word `retranscribe` and Kimaki transcribes that message and routes it like a new voice message (steer, queue, btw or new session), with the usual transcript echo. The word itself is never sent to the agent. A `retranscribe` reply to a message without audio stays a normal text prompt.

```
🎤 voice message (0:24)          ← sent while the bot was down
  ↳ retranscribe                 ← your reply
-# » you: <transcript>           ← Kimaki echoes it and runs the prompt
```
