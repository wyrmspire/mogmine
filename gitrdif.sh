#!/usr/bin/env bash
# =============================================================================
# gitrdif.sh — Diff dump since the last printcode full dump
# =============================================================================
#
# Writes gitrdif00.md … with everything changed in the local files since the
# last full dump (committed, uncommitted and new files), then runs
# ./printcode.sh so the full dumps are current and the next run starts here.
# If nothing changed, existing files are left alone.
#
# Usage:
#   ./gitrdif.sh                 # changes since last dump, then full dump
#   ./gitrdif.sh abc1234         # look back: from-ref → local files, no full dump
#   ./gitrdif.sh --from abc1234
#   ./gitrdif.sh --to def5678    # look back: baseline → that ref, no full dump
#   ./gitrdif.sh --help
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BASELINE_FILE="$ROOT/.last-dump-commit"
OUTPUT_PREFIX="gitrdif"
MAX_LINES_PER_FILE=8000
FROM_REF=""
TO_REF=""

usage() {
  sed -n '2,17p' "$0" | sed 's/^# \?//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --from)
      [[ $# -ge 2 ]] || { echo "Error: --from needs a ref" >&2; exit 1; }
      FROM_REF="$2"
      shift 2
      ;;
    --to)
      [[ $# -ge 2 ]] || { echo "Error: --to needs a ref" >&2; exit 1; }
      TO_REF="$2"
      shift 2
      ;;
    -*)
      echo "Error: unknown option $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ -n "$FROM_REF" ]]; then
        echo "Error: unexpected argument $1" >&2
        exit 1
      fi
      FROM_REF="$1"
      shift
      ;;
  esac
done

# A look-back (explicit ref) reports only; a plain run also refreshes the dumps.
REFRESH_DUMPS=false
if [[ -z "$FROM_REF" && -z "$TO_REF" ]]; then
  REFRESH_DUMPS=true
fi

if [[ -z "$FROM_REF" ]]; then
  if [[ -f "$BASELINE_FILE" ]]; then
    FROM_REF="$(tr -d '[:space:]' < "$BASELINE_FILE")"
  else
    echo "Error: no baseline at $BASELINE_FILE" >&2
    echo "Run ./printcode.sh once (it records one), or pass a from-ref:" >&2
    echo "  ./gitrdif.sh <commit>" >&2
    exit 1
  fi
fi

if ! git rev-parse --verify "$FROM_REF^{commit}" >/dev/null 2>&1; then
  echo "Error: cannot resolve from-ref: $FROM_REF" >&2
  exit 1
fi
if [[ -n "$TO_REF" ]] && ! git rev-parse --verify "$TO_REF^{commit}" >/dev/null 2>&1; then
  echo "Error: cannot resolve to-ref: $TO_REF" >&2
  exit 1
fi

FROM_SHA="$(git rev-parse "$FROM_REF^{commit}")"
if [[ -n "$TO_REF" ]]; then
  LOG_TO="$(git rev-parse "$TO_REF^{commit}")"
  TO_TREE="$LOG_TO"
  TO_LABEL="\`$(git rev-parse --short "$LOG_TO")\` — $(git log -1 --format='%s' "$LOG_TO")"
else
  LOG_TO="$(git rev-parse HEAD)"
  TO_TREE="$(bash "$ROOT/scripts/dump-snapshot.sh")"
  TO_LABEL="local files now (HEAD \`$(git rev-parse --short HEAD)\`)"
fi
FROM_SHORT="$(git rev-parse --short "$FROM_SHA")"
RANGE="${FROM_SHA}..${LOG_TO}"

PATHS=(
  .
  ':(exclude)dump*.md'
  ':(exclude)gitrdif*.md'
  ':(exclude)MogMine*'
  ':(exclude)DESIGN-PRINCIPLES-REVIEW.md'
  ':(exclude)docs/audit-images'
  ':(exclude)docs/design'
  ':(exclude)docs/design-*'
  ':(exclude)docs/playbook-design'
  ':(exclude)node_modules'
  ':(exclude)dist'
  ':(exclude).next'
  ':(exclude)package-lock.json'
  # Data files, matching what printcode.sh leaves out
  ':(exclude,glob)**/data/**'
  ':(exclude,glob)**/cache/**'
  ':(exclude,glob)**/shards/**'
  ':(exclude,glob)**/results/**'
  ':(exclude,glob)**/*.parquet'
  ':(exclude,glob)**/continuous_contract.json'
  ':(exclude,glob)**/sample-bars.json'
)

if git diff --quiet "$FROM_SHA" "$TO_TREE" -- "${PATHS[@]}"; then
  echo "Nothing new since $FROM_SHORT. Existing dump and gitrdif files left as they are."
  exit 0
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

{
  echo "# MogMine git diff dump"
  echo "Generated: $(date)"
  echo
  echo "## Range"
  echo
  echo "- **From (previous full dump):** \`$FROM_SHORT\`"
  echo "- **To:** $TO_LABEL"
  echo
  echo "This is a **diff dump** for chat when a prior \`dump00.md\`… set is already posted."
  echo "It covers committed, uncommitted and new files."
  echo "For a full tree dump, run \`./printcode.sh\` instead."
  echo
  echo "## Commits"
  echo
  echo '```'
  # NOTE: do not test with "git log | grep -q ." here - under pipefail,
  # grep -q closes the pipe on first match, git dies with SIGPIPE, and the
  # pipeline reports failure even when the range is full of commits (that
  # is how a 1,791-addition range once printed "(no commits in range)").
  if [ "$(git rev-list --count "$RANGE")" -gt 0 ]; then
    git log --oneline --no-decorate "$RANGE"
  else
    echo "(no commits in range)"
  fi
  echo '```'
  echo
  echo "## Diffstat"
  echo
  echo '```'
  git diff --stat "$FROM_SHA" "$TO_TREE" -- "${PATHS[@]}"
  echo '```'
  echo
  echo "## Patch"
  echo
  echo '```diff'
  git diff "$FROM_SHA" "$TO_TREE" -- "${PATHS[@]}"
  echo '```'
} > "$TMP"

refresh_dumps() {
  if [[ "$REFRESH_DUMPS" == true ]]; then
    echo "Refreshing the full dump…"
    bash "$ROOT/printcode.sh"
  fi
}

# Remove old outputs
rm -f "$ROOT"/${OUTPUT_PREFIX}[0-9][0-9].md

total_lines="$(wc -l < "$TMP" | tr -d ' ')"
if [[ "$total_lines" -le "$MAX_LINES_PER_FILE" ]]; then
  mv "$TMP" "$ROOT/${OUTPUT_PREFIX}00.md"
  trap - EXIT
  echo "Wrote ${OUTPUT_PREFIX}00.md ($total_lines lines)  since $FROM_SHORT"
  refresh_dumps
  exit 0
fi

# Split into numbered parts
part=0
start=1
while [[ "$start" -le "$total_lines" ]]; do
  end=$((start + MAX_LINES_PER_FILE - 1))
  if [[ "$end" -gt "$total_lines" ]]; then
    end="$total_lines"
  fi
  outfile=$(printf '%s/%s%02d.md' "$ROOT" "$OUTPUT_PREFIX" "$part")
  {
    if [[ "$part" -gt 0 ]]; then
      echo "# MogMine git diff dump (continued $part)"
      echo "Generated: $(date)"
      echo "Since: \`$FROM_SHORT\` — continuation of ${OUTPUT_PREFIX}00.md"
      echo
    fi
    sed -n "${start},${end}p" "$TMP"
  } > "$outfile"
  echo "Wrote $(basename "$outfile") (lines $start–$end)"
  part=$((part + 1))
  start=$((end + 1))
done
echo "Done: since $FROM_SHORT → ${OUTPUT_PREFIX}00.md…"
refresh_dumps
