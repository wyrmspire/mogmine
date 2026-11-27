#!/usr/bin/env bash
# Prints a git tree ID of the local files as they are right now (committed,
# uncommitted and new files; git-ignored files left out). Used by printcode.sh
# and gitrdif.sh. Works on a throwaway index, so staged changes are untouched.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

real_index="$(git rev-parse --git-path index)"
if [[ -f "$real_index" ]]; then
  cp "$real_index" "$tmp_dir/index"
fi

export GIT_INDEX_FILE="$tmp_dir/index"
git add -A
git write-tree
