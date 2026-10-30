# Upstream sync procedure (read when the fork watcher wakes you)

The watcher (`fork/upstream-watch.sh`, run as a Kimaki routine `--pre-run`) appended a report: new upstream commits, overlapping files, trial-rebase conflicts, feature probes, and direction signals (branches, `plans/`, pending `.changeset/`).

Goal: `tailored/v1` = latest upstream + only the fork commits that still add something. No duplicates, no regressions, production untouched.

1. Work in a fresh worktree off `tailored/v1` (never in production installs, never on `tailored/main`). Keep `core.autocrlf=false`.
2. For each fork feature the probes flag, or whose hook files upstream touched: read the upstream change. If upstream now covers it, **drop the fork commit** (and its test and changeset), and keep only a fork-specific test if upstream lacks coverage. If upstream solved it differently and worse, keep ours and say why. If upstream partly covers it, shrink the fork commit to the difference.
3. Rebase onto `upstream/main` and resolve conflicts by keeping upstream's structure and re-adding fork hooks as thin calls into fork files. Update `fork/features.tsv` probes when a hook moves.
4. Build (`pnpm build` in `kimaki`) and run the suite in the isolated environment from `docs/fork/README.md`. Compare against the same suite on unmodified upstream; only failures upstream also has are acceptable.
5. Changes external tools depend on (CLI output, commands, voice): run the consumer check from `docs/fork/README.md`.
6. Before pushing, keep the old head as `backup/tailored-v1-<old-sha>`. Then push with `--force-with-lease` over SSH (`git@github.com:Xipzer/kimaki.git`). This repo is public: never put Discord links, session IDs, private notes or personal data in commits or messages.
7. Direction signals: read `docs/fork/upstream-direction.md` (private notes, local only, never committed), then for new feature branches and plans note what upstream is building that overlaps or conflicts with fork plans, and propose (don't build) any front-run.
8. Anything meant for upstream (a PR, or a fork commit that should become one) follows `docs/fork/upstream-style.md` in the `kimaki-v1` checkout (local notes on the maintainer's conventions and how he rewrote earlier PRs) and its pre-PR checklist. After he takes a PR, diff ours against his commit and add what changed to those notes.
9. Report in the thread: what was dropped, kept, and changed, with test results compared to upstream. **Never switch production without the owner's go-ahead.**
