#!/bin/sh
set -eu

CODEX_VERSION="0.158.0"
CODEX_BIN="$HOME/.local/bin/codex"

if [ ! -x "$CODEX_BIN" ]; then
  export CODEX_RELEASE="$CODEX_VERSION"
  export CODEX_NON_INTERACTIVE=1
  export CODEX_INSTALL_DIR="$HOME/.local/bin"
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
fi

"$CODEX_BIN" --version
exec node deploy/web.mjs
