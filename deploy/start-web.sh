#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"
export PATH="$ROOT_DIR/node_modules/.bin:$PATH"

# Faable is a small shared runtime. Keep model housekeeping out of the hot path;
# context compaction still runs synchronously before the next turn when needed.
export DIZA_RESOURCE_CONSTRAINED=1

WARMUP_PID=""
node deploy/faable-warmup.mjs &
WARMUP_PID=$!

cleanup_warmup() {
  if [ -n "$WARMUP_PID" ] && kill -0 "$WARMUP_PID" 2>/dev/null; then
    kill "$WARMUP_PID" 2>/dev/null || true
    wait "$WARMUP_PID" 2>/dev/null || true
  fi
}
trap cleanup_warmup EXIT INT TERM

# Give the warmup listener a moment to claim Faable's assigned port before
# potentially slow npm installs begin. This keeps the deployment healthy
# even when registry/network latency makes CLI installation take minutes.
sleep 0.2
if ! kill -0 "$WARMUP_PID" 2>/dev/null; then
  echo "[diza-warmup] failed to start" >&2
  exit 1
fi

CODEX_BIN="$ROOT_DIR/node_modules/.bin/codex"
CODEX_PROXY="http://127.0.0.1:3129"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

if [ ! -x "$CODEX_BIN" ]; then
  echo "[diza-faable] build-installed Codex CLI is missing" >&2
  exit 1
fi
"$CODEX_BIN" --version

# This Faable deployment is the Codex lane. Installing the Grok CLI in the
# foreground can exceed the runtime startup window and keep the whole app in
# INITIALIZING. Keep Grok available as an explicit opt-in without blocking
# Codex/web startup.
GROK_BIN="$HOME/.local/bin/grok"
if [ "${DIZA_FAABLE_INSTALL_GROK_CLI:-0}" = "1" ]; then
  if [ ! -x "$GROK_BIN" ]; then
    npm install -g --prefix "$HOME/.local" --no-audit --no-fund "@xai-official/grok@1.0.44"
  fi
  "$GROK_BIN" --version
else
  echo "[diza-faable] Grok CLI startup install skipped; Codex lane only"
fi

GEMINI_BIN="$ROOT_DIR/node_modules/.bin/gemini"
if [ ! -x "$GEMINI_BIN" ]; then
  echo "[diza-faable] build-installed Gemini CLI is missing" >&2
  exit 1
fi
"$GEMINI_BIN" --version

# Faable installs manifest dependencies during the build. Validate the two
# persistence clients cheaply here instead of downloading them during boot.
node -e 'require("pg"); require("@aws-sdk/client-s3")'

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

cleanup_warmup
WARMUP_PID=""
trap - EXIT INT TERM
exec node deploy/web.mjs
