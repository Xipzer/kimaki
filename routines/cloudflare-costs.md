---
title: Weekly Cloudflare cost report
description: >
  Managed by a kimaki routine. Do not move or delete this file
  without also updating the routine (kimaki routine list / kimaki routine edit).
---

# Weekly Cloudflare cost report

Goal: tell Tommy how much the Cloudflare account spends this month, per project, and flag anything that grew.

1. Load the `cloudflare-costs` skill and follow it.
2. Run the report for the month to date. Use yesterday as `--to` (full days only). On the 1st of a month, report the full previous month instead.
   ```bash
   mkdir -p ~/.config/cloudflare-costs
   bun ~/.config/opencode/skills/cloudflare-costs/cost-report.ts --to <yesterday> --json > ~/.config/cloudflare-costs/<yesterday>.json
   bun ~/.config/opencode/skills/cloudflare-costs/cost-report.ts --to <yesterday>
   ```
3. Compare with the newest older file in `~/.config/cloudflare-costs/`, if any. Call out projects whose month estimate grew more than 25% or more than $10.
4. Reply in short ASD-STE100 English:
   - net month estimate and gross
   - table of projects at or above $1, with main driver
   - changes since last week
   - one line per suspicious item with the likely cause (for example DO duration with no hibernation, KV writes per request)
   - note that numbers are list-price estimates, not the invoice
5. Always mention `<@535922349652836367>` at the top of the reply with the net month estimate.

If `cf auth whoami` fails, mention Tommy and ask him to run `cf auth login`. Do not change any code or Cloudflare resources.
