#!/bin/sh
set -eu

CODEX_VERSION="0.158.0"
CODEX_BIN="$HOME/.local/bin/codex"
CODEX_PROXY="http://127.0.0.1:3129"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

if [ ! -x "$CODEX_BIN" ]; then
  npm install -g --prefix "$HOME/.local" --no-audit --no-fund "@openai/codex@$CODEX_VERSION"
fi

"$CODEX_BIN" --version

node deploy/codex-ipv4-proxy.mjs &

export CODEX_HOME
export HTTPS_PROXY="$CODEX_PROXY"
export HTTP_PROXY="$CODEX_PROXY"
export ALL_PROXY="$CODEX_PROXY"
export NO_PROXY="127.0.0.1,localhost"
export https_proxy="$CODEX_PROXY"
export http_proxy="$CODEX_PROXY"
export all_proxy="$CODEX_PROXY"
export no_proxy="127.0.0.1,localhost"

# Codex loads proxy settings from $CODEX_HOME/.env in addition to the
# process environment. Keep the Faable runtime pinned to the local IPv4
# proxy so ChatGPT device-auth uses the same known-good route as our probe.
mkdir -p "$CODEX_HOME"
cat > "$CODEX_HOME/.env" <<EOF
HTTPS_PROXY=$CODEX_PROXY
HTTP_PROXY=$CODEX_PROXY
ALL_PROXY=$CODEX_PROXY
NO_PROXY=127.0.0.1,localhost
https_proxy=$CODEX_PROXY
http_proxy=$CODEX_PROXY
all_proxy=$CODEX_PROXY
no_proxy=127.0.0.1,localhost
EOF
chmod 600 "$CODEX_HOME/.env"

exec node deploy/web.mjs
