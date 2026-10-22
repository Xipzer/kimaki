---
'kimaki': patch
---

Fix blockquotes with empty lines showing literal `>` characters in Discord.

Models often separate quoted paragraphs with a bare `>` line:

```md
> Hi Mohammad,
>
> Tommy
```

Discord only renders a quote line when `>` is followed by a space, so the bare lines showed up as `>` text between quote blocks. Kimaki now sends them as `> ` and the quote stays one block with blank lines.
