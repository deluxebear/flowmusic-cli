#!/usr/bin/env bash
# Verify that the flowmusic CLI is installed, logged in and the API is reachable.
# Exit codes: 0 ready | 2 not installed | 3 not logged in | 4 API problem
set -u

if command -v flowmusic >/dev/null 2>&1; then
  FM=(flowmusic)
elif [ -n "${FLOWMUSIC_REPO:-}" ] && [ -f "$FLOWMUSIC_REPO/bin/flowmusic.mjs" ]; then
  FM=(node "$FLOWMUSIC_REPO/bin/flowmusic.mjs")
else
  echo "NOT INSTALLED: run 'npm install -g .' in the gfmusic repo (Node >= 22), or set FLOWMUSIC_REPO=<repo path>" >&2
  exit 2
fi

echo "flowmusic $("${FM[@]}" --version)"

if [ -z "${FLOWMUSIC_TOKEN:-}" ]; then
  if ! "${FM[@]}" whoami 2>/dev/null; then
    echo "NOT LOGGED IN: ask the user to run 'flowmusic login' (browser sign-in), then retry." >&2
    exit 3
  fi
fi

if ! out=$("${FM[@]}" credits 2>&1); then
  echo "API PROBLEM: $out" >&2
  echo "Hint: run 'flowmusic doctor' for a detailed check." >&2
  exit 4
fi
echo "$out"
echo "READY"
