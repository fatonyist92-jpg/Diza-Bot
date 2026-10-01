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

GROK_BIN="$HOME/.local/bin/grok"
if [ ! -x "$GROK_BIN" ]; then
  npm install -g --prefix "$HOME/.local" --no-audit --no-fund "@xai-official/grok@1.0.44"
fi
"$GROK_BIN" --version

GEMINI_VERSION="0.61.0"
GEMINI_BIN="$HOME/.local/bin/gemini"
if [ ! -x "$GEMINI_BIN" ]; then
  npm install -g --prefix "$HOME/.local" --no-audit --no-fund "@google/gemini-cli@$GEMINI_VERSION"
fi
"$GEMINI_BIN" --version

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

# Faable's runtime image does not expose a conventional Linux CA bundle,
# while Node carries a trusted root set that already verifies the same
# OpenAI endpoint through this proxy. Export that root set as a PEM bundle
# for Codex's shared HTTP client.
mkdir -p "$CODEX_HOME"
CODEX_CA_BUNDLE="$CODEX_HOME/node-root-ca.pem"
node -e 'const fs=require("node:fs");const tls=require("node:tls");fs.writeFileSync(process.argv[1],tls.rootCertificates.join("\n")+"\n",{mode:0o600})' "$CODEX_CA_BUNDLE"
export CODEX_CA_CERTIFICATE="$CODEX_CA_BUNDLE"

# Codex loads network settings from $CODEX_HOME/.env in addition to the
# process environment. Keep device-auth on the same known-good IPv4 proxy
# and give Codex the same CA roots as the successful Node TLS probe.
cat > "$CODEX_HOME/.env" <<EOF
HTTPS_PROXY=$CODEX_PROXY
HTTP_PROXY=$CODEX_PROXY
ALL_PROXY=$CODEX_PROXY
NO_PROXY=127.0.0.1,localhost
https_proxy=$CODEX_PROXY
http_proxy=$CODEX_PROXY
all_proxy=$CODEX_PROXY
no_proxy=127.0.0.1,localhost
CODEX_CA_CERTIFICATE=$CODEX_CA_BUNDLE
EOF
chmod 600 "$CODEX_HOME/.env" "$CODEX_CA_BUNDLE"

exec node deploy/web.mjs
