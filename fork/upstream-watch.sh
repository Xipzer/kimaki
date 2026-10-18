#!/usr/bin/env bash
# Fork upstream watcher. Deterministic, no model calls: one `git fetch` per run.
#
#   no upstream change            -> exit 1 (Kimaki --pre-run skips the routine, nothing wakes)
#   new commits/branches/plans    -> trial rebase in a throwaway worktree, feature probes,
#                                    report on stdout, exit 0 (the routine wakes the agent)
#
# Usage: fork/upstream-watch.sh [--force]   (--force reports even when nothing changed)
# Env:   FORK_REPO (default: this checkout), FORK_BRANCH (tailored/v1), UPSTREAM (upstream),
#        FORK_WATCH_STATE (~/.local/state/kimaki-fork-watch), FORK_WATCH_NO_FETCH=1 (tests)

set -u
export LC_ALL=C GIT_TERMINAL_PROMPT=0
export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=fork-watch GIT_AUTHOR_EMAIL=fork-watch@localhost GIT_COMMITTER_NAME=fork-watch GIT_COMMITTER_EMAIL=fork-watch@localhost
here=$(cd "$(dirname "$0")" && pwd)
repo=${FORK_REPO:-$(cd "$here/.." && pwd)}
branch=${FORK_BRANCH:-tailored/v1}
upstream=${UPSTREAM:-upstream}
state=${FORK_WATCH_STATE:-$HOME/.local/state/kimaki-fork-watch}
force=${1:-}
mkdir -p "$state"
g() { git -C "$repo" "$@"; }

[ -n "${FORK_WATCH_NO_FETCH:-}" ] || g fetch -q --prune "$upstream" 2>"$state/fetch.err" || { echo "fork-watch: fetch failed: $(head -c 300 "$state/fetch.err")"; exit 0; }

main=$(g rev-parse "$upstream/main")
heads=$(g for-each-ref --format='%(refname:short) %(objectname:short)' "refs/remotes/$upstream" | grep -v "^$upstream/HEAD" | sort)
signature=$(printf '%s\n%s\n' "$main" "$heads" | sha1sum | cut -c1-16)
last_main=$(cat "$state/main" 2>/dev/null || echo "")
last_sig=$(cat "$state/signature" 2>/dev/null || echo "")
last_heads=$(cat "$state/heads" 2>/dev/null || echo "")
if [ "$signature" = "$last_sig" ] && [ "$force" != "--force" ]; then exit 1; fi

base=$(g merge-base "$branch" "$upstream/main")
since=${last_main:-$base}
g cat-file -e "$since^{commit}" 2>/dev/null || since=$base
new_commits=$(g rev-list --count "$since..$upstream/main")
fork_commits=$(g rev-list --count "$upstream/main..$branch")
behind=$(g rev-list --count "$branch..$upstream/main")

echo "# Upstream Kimaki changed"
echo
echo "- upstream/main: \`$(g rev-parse --short "$upstream/main")\` ($(g log -1 --format=%cs "$upstream/main")), **$new_commits new commit(s)** since the last check"
echo "- $branch: $fork_commits fork commit(s), $behind upstream commit(s) behind"
tag=$(g tag --points-at "$upstream/main" 2>/dev/null | head -1)
[ -n "$tag" ] && echo "- release tag on upstream/main: \`$tag\`"
echo

if [ "$new_commits" -gt 0 ]; then
  echo "## New upstream commits"
  g log --format='- `%h` %s' "$since..$upstream/main" | head -40
  [ "$new_commits" -gt 40 ] && echo "- ... $((new_commits - 40)) more"
  echo
fi

# Files the fork changed that upstream also changed since the merge base.
fork_files=$(g diff --name-only "$base" "$branch" | sort -u)
up_files=$(g diff --name-only "$base" "$upstream/main" | sort -u)
overlap=$(comm -12 <(echo "$fork_files") <(echo "$up_files"))
echo "## Overlap (fork files upstream also changed)"
if [ -n "$overlap" ]; then echo "$overlap" | sed 's/^/- `/; s/$/`/'; else echo "- none"; fi
echo

# Trial rebase in a throwaway worktree: conflicts per fork commit.
tmp=$(mktemp -d "${TMPDIR:-/tmp}/fork-watch.XXXXXX")
g worktree add -q --detach "$tmp/wt" "$branch" 2>/dev/null
echo "## Trial rebase onto upstream/main"
if git -C "$tmp/wt" rebase -q "$upstream/main" >"$tmp/rebase.log" 2>&1; then
  echo "- clean: all $fork_commits fork commit(s) apply"
else
  while :; do
    stopped=$(git -C "$tmp/wt" log -1 --format='%s' REBASE_HEAD 2>/dev/null || echo '?')
    files=$(git -C "$tmp/wt" diff --name-only --diff-filter=U | tr '\n' ' ')
    [ -z "$files" ] && break
    echo "- CONFLICT in \"$stopped\": $files"
    git -C "$tmp/wt" -c core.editor=true rebase --skip >/dev/null 2>&1 || break
  done
  git -C "$tmp/wt" rebase --abort >/dev/null 2>&1
fi
g worktree remove --force "$tmp/wt" >/dev/null 2>&1
rm -rf "$tmp"
echo

# Feature probes: does upstream now do what a fork commit does?
echo "## Fork features vs upstream"
grep -v '^#' "$here/features.tsv" | while IFS=$'\t' read -r id subject hooks probe pattern pathspec; do
  [ -z "$id" ] && continue
  if g grep -qE "$pattern" "$upstream/main" -- "$pathspec" 2>/dev/null; then hit=1; else hit=0; fi
  if { [ "$probe" = present ] && [ $hit = 1 ]; } || { [ "$probe" = absent ] && [ $hit = 0 ]; }; then
    verdict="**upstream may cover it now - check for redundancy**"
  else
    verdict="still fork-only"
  fi
  touched=$(g log --format='%h' "$since..$upstream/main" -- $(echo "$hooks" | tr ',' ' ') | wc -l)
  echo "- \`$id\`: $verdict; $touched new upstream commit(s) touch its hook files"
done
echo

# Direction signals: branches, plans, pending changesets, docs.
echo "## Direction signals"
now_heads=$(echo "$heads")
changed_heads=$(comm -13 <(echo "$last_heads") <(echo "$now_heads") | grep -v "^$upstream/main " || true)
if [ -n "$changed_heads" ]; then
  echo "$changed_heads" | while read -r ref sha; do
    ahead=$(g rev-list --count "$upstream/main..$ref" 2>/dev/null || echo 0)
    [ "$ahead" = 0 ] && continue
    echo "- branch \`$ref\` -> \`$sha\` ($ahead commit(s) not on main): $(g log -1 --format=%s "$ref" 2>/dev/null)"
  done
else
  echo "- no new or moved upstream branches"
fi
g diff --name-status "$since" "$upstream/main" -- plans docs .changeset ':!.changeset/readme.md' | sed 's/^/- /' | head -30
echo
echo "Full logs: \`git -C $repo log $since..$upstream/main\`. Process: \`fork/SYNC.md\`."

printf '%s\n' "$main" > "$state/main"
printf '%s\n' "$signature" > "$state/signature"
printf '%s\n' "$heads" > "$state/heads"
exit 0
