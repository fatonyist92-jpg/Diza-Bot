#!/bin/sh
set -eu

CODEX_VERSION="0.158.0"
CODEX_BIN="$HOME/.local/bin/codex"

if [ ! -x "$CODEX_BIN" ]; then
  npm install -g --prefix "$HOME/.local" --no-audit --no-fund "@openai/codex@$CODEX_VERSION"
fi

"$CODEX_BIN" --version
exec node deploy/web.mjs
