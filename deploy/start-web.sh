#!/bin/sh
set -eu

CODEX_VERSION="0.158.0"
CODEX_BIN="$HOME/.local/bin/codex"

if [ ! -x "$CODEX_BIN" ]; then
  npm install -g --prefix "$HOME/.local" --no-audit --no-fund "@openai/codex@$CODEX_VERSION"
fi

"$CODEX_BIN" --version

node deploy/codex-ipv4-proxy.mjs &
export HTTPS_PROXY="http://127.0.0.1:3129"
export HTTP_PROXY="http://127.0.0.1:3129"
export NO_PROXY="127.0.0.1,localhost"

exec node deploy/web.mjs
