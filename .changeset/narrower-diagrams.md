---
'kimaki': patch
---

`kimaki diagram` keeps diagrams readable in Discord.

- **Square layout:** it renders the source layout and a compact one (wrapped labels, `LR` turned into `TB`) and keeps the one closest to square, so Discord no longer shrinks a long row or column until the text is unreadable. The diagram prompt asks agents to wrap long pipelines into rows: `flowchart TB` with subgraphs that set `direction LR`.
- **Light by default:** diagrams use a light theme with the same color classes (`:::blue`, `:::green`, ...). Pass `--dark` for the previous dark theme.
