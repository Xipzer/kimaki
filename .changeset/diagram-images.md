---
'kimaki': minor
---

Agents now draw diagrams as images instead of ASCII art. The new `kimaki diagram <file.mmd> -o out.png` command renders Mermaid source (flowchart, sequence, state, ER, gitGraph, mindmap, charts and more) to a dark, colorful PNG, which agents then post with `kimaki upload-to-discord`. Rendering runs locally in Node with [pele](https://pele.run) and resvg, no browser needed. The `--disable-prompt` section `ascii-diagrams` is now called `diagrams`.
