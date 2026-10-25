---
'kimaki': patch
---

Show `kimaki send` prompts in full in the Discord thread. The `» **CLI:** prompt` line was cut at about 1900 characters; a longer prompt is now split into several messages, like long model replies. Scheduled prompts are shown in full too. A prompt that waits in the queue of a busy thread shows in its queue notice instead, cut to one message.

Long model text is also split more cleanly: at line breaks first, then sentences, then words, and without doubled spaces where a paragraph was split by words.
