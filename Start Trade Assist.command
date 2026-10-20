#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
TRADE_NODE="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [ ! -x "$TRADE_NODE" ]; then TRADE_NODE="$(command -v node || true)"; fi
if [ -z "$TRADE_NODE" ]; then echo 'Node.js 22 or later is required.'; read -r -p 'Press Enter to close.'; exit 1; fi
TRADE_VERSION="$($TRADE_NODE -p 'Number(process.versions.node.split(".")[0])')"
if [ "$TRADE_VERSION" -lt 22 ]; then echo 'Node.js 22 or later is required.'; read -r -p 'Press Enter to close.'; exit 1; fi
export PATH="$(dirname "$TRADE_NODE"):$PATH"
TRADE_URL='http://127.0.0.1:5173/'
if curl --silent --fail "${TRADE_URL}api/health" | /usr/bin/grep -q 'Trade Assist'; then
  open "$TRADE_URL"
  echo "Trade Assist is already running at $TRADE_URL"
  exit 0
fi
if [ ! -f '.env.local' ]; then echo 'The secure local API connection is missing. Return to Codex to reconnect it.'; read -r -p 'Press Enter to close.'; exit 1; fi
printf '\nStarting Trade Assist…\nKeep this window open while using the app. Press Control-C to stop.\n\n'
"$TRADE_NODE" --env-file=.env.local scripts/run-framework.mjs dev &
TRADE_PID=$!
trap 'kill "$TRADE_PID" 2>/dev/null || true' EXIT INT TERM
for TRADE_TRY in {1..60}; do
  if curl --silent --fail "${TRADE_URL}api/health" | /usr/bin/grep -q 'Trade Assist'; then open "$TRADE_URL"; break; fi
  if ! kill -0 "$TRADE_PID" 2>/dev/null; then echo 'The app did not start. See the error above.'; read -r -p 'Press Enter to close.'; exit 1; fi
  sleep 1
done
wait "$TRADE_PID"
