#!/usr/bin/env bash
# Fetch (or follow) the ideation service logs from the exe.dev VM.
#
# The app logs to stdout, which systemd captures in the journal. This pulls those
# lines down so a session can "see" what happened on the server — agent tool calls
# (logged via /api/log), texture lookups, image generations, and any errors.
#
# Usage:
#   ./scripts/logs.sh                # last 80 lines
#   ./scripts/logs.sh 200            # last 200 lines
#   ./scripts/logs.sh -f             # follow live (Ctrl-C to stop)
#   ./scripts/logs.sh 200 texture    # last 200 lines, only those matching "texture"
#   ./scripts/logs.sh -f client      # follow live, only client-bridge lines
set -euo pipefail

VM="armchair-sparkle.exe.xyz"
UNIT="ideation"

LINES=80
FOLLOW=""
PATTERN=""

for arg in "$@"; do
  case "$arg" in
    -f | --follow) FOLLOW="-f" ;;
    *[!0-9]*) PATTERN="$arg" ;; # non-numeric → treat as a grep pattern
    *) LINES="$arg" ;;          # all-digits → line count
  esac
done

REMOTE="sudo journalctl -u ${UNIT} --no-pager -n ${LINES} ${FOLLOW}"
if [[ -n "$PATTERN" ]]; then
  # Pass the pattern as a literal argument to grep on the remote side.
  REMOTE="${REMOTE} | grep --line-buffered -i -F -- $(printf '%q' "$PATTERN")"
fi

echo "==> ${VM}: journalctl -u ${UNIT} (n=${LINES}${FOLLOW:+, follow}${PATTERN:+, match='${PATTERN}'})" >&2
exec ssh "${VM}" "${REMOTE}"
