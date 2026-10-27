---
'@kimaki/plugin-fallback': patch
---

Use newer models in the default fallback ranking: `openai/gpt-6.1-sol`, `xai/grok-4.7`, then `opencode-go/kimi-k3`. Copilot now falls back to `github-copilot/gpt-6.1-sol`. Set `options.models` to use your own ranking.
