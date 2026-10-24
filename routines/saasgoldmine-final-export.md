---
title: SaaS Goldmine final CSV export
description: >
  Managed by a kimaki routine. Do not move or delete this file
  without also updating the routine (kimaki routine list / kimaki routine edit).
---

The SaaS Goldmine subscription ends on 2026-11-11. Export the full list one last time.

1. Load the `playwriter` skill. Open a new tab at https://saasgoldmine.com/dashboard (user is logged in as beats.by.morse@gmail.com).
2. Download the full export: create an `<a href="/api/export" download>` in the page and click it. Do not use `fetch` in `page.evaluate` (the page reloads and kills the context). Chrome saves it to `~/Downloads/saas-goldmine-all-<date>.csv`.
3. Verify the file: row count, header columns, compare domain count with `~/Downloads/saas-goldmine-all-2026-10-23.csv` (21,829 rows).
4. Also export each category if the Export link supports it: `/api/export?category=SaaS`, `Special`, `TrustMRR`, `Tools`.
5. Copy all files to `/Users/morse/Documents/GitHub/celato/tmp/saas-goldmine/input/`.

If access is already gone or the export fails, mention <@535922349652836367> and say so. On success, mention <@535922349652836367> with file paths and row counts.
