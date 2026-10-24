---
title: Daily compromised commits check
description: >
  Managed by a kimaki routine. Do not move or delete this file
  without also updating the routine (kimaki routine list / kimaki routine edit).
---

# Daily compromised commits check

Goal: detect if Tommy's GitHub account `remorses` was hacked. Check the last 24 hours of commits for obfuscated or malicious code. Read only: never change repos.

## 1. Get the commits

Repos pushed in the last 24 hours:

```bash
SINCE=$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ)
gh repo list remorses --limit 1000 --json nameWithOwner,pushedAt --jq ".[] | select(.pushedAt > \"$SINCE\") | .nameWithOwner"
```

For each repo, update a bare mirror (all branches) and list its commits:

```bash
D=/private/var/folders/8w/wvmrpgms5hngywvs8s99xnmm0000gn/T/opencode/commit-audit
mkdir -p $D && cd $D
[ -d <name> ] || git clone -q --filter=blob:none --bare https://github.com/<owner>/<name> <name>
git -C <name> fetch -q --prune origin '+refs/heads/*:refs/heads/*'
git -C <name> log --all --since='24 hours ago' --format='%h %an <%ae> | %cn <%ce> | %ad | %s'
```

Read the diffs, skipping lock and generated files:

```bash
git -C <name> log --all --since='24 hours ago' -p -- . ':!*lock*' ':!*.snap' ':!dist/**'
```

## 2. Look for

- obfuscated code: long base64 or hex blobs, `eval`, `new Function`, `atob`, `String.fromCharCode` chains, `_0x` names, very long single lines
- new `preinstall` / `postinstall` / `prepare` scripts in package.json
- code that reads secrets, env vars, `~/.ssh`, `~/.npmrc`, wallets or browser data and sends them over the network
- new or changed GitHub Actions workflows that leak secrets or publish packages
- unknown author or committer emails combined with any of the above

Not findings: normal minified build output, legit base64 assets (images, fonts, wasm), normal refactors, PRs from known contributors with normal code.

## 3. Report

- Nothing suspicious: write one line "No suspicious commits." Do NOT mention Tommy. Then archive the thread with `kimaki session archive <this thread id>`.
- Something suspicious: start with `<@535922349652836367>`. For each finding, in short ASD-STE100 English: repo, SHA, link (`https://github.com/<repo>/commit/<sha>`), short code snippet, why it is suspicious.
- If `gh` or `git` fails, mention Tommy and say which command failed.
