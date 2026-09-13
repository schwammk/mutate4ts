#!/bin/sh
# Check the recorded upstream revisions for changes.
# On change: fetches the remote, lists new commits, prints an evaluation reminder.
# After evaluating a change: update the SHA in .upstream (+ the table in
# UPSTREAM.md) and append a decision-log row to UPSTREAM.md.
set -e
cd "$(dirname "$0")/.."

while read -r name remote branch sha; do
  [ -n "$name" ] || continue
  current=$(git ls-remote "$remote" "refs/heads/$branch" | cut -f1)
  if [ "$current" = "$sha" ]; then
    echo "$name: unchanged ($sha)"
  else
    echo "$name: MOVED $sha -> $current"
    git fetch "$remote" "$branch"
    git log --oneline "$sha..$remote/$branch" || true
    echo "  (evaluate, then update .upstream and the UPSTREAM.md decision log)"
  fi
done < .upstream
