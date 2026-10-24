---
'kimaki': patch
---

Show `kimaki send` prompts in full in the Discord thread. The `» **CLI:** prompt` line was cut at about 1900 characters; a longer prompt is now split into several messages, like long model replies. Queued and scheduled prompts are shown in full too.

Long model text is also split more cleanly: at line breaks first, then sentences, then words, and without doubled spaces where a paragraph was split by words.
