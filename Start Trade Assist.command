#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
TRADE_NODE="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [ ! -x "$TRADE_NODE" ]; then TRADE_NODE="$(command -v node || true)"; fi
if [ -z "$TRADE_NODE" ]; then echo 'Node.js 22 or later is required.'; read -r -p 'Press Enter to close.'; exit 1; fi
"$TRADE_NODE" scripts/start-local.mjs
open 'http://127.0.0.1:5173/'
