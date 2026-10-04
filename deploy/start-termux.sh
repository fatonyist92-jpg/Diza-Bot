#!/data/data/com.termux/files/usr/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[DIZA] Node.js belum terpasang di Termux." >&2
  exit 1
fi

NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "[DIZA] Node.js 22+ diperlukan. Versi saat ini: $(node -v)" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[DIZA] pnpm belum tersedia. Aktifkan Corepack atau pasang pnpm terlebih dahulu." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[DIZA] Memasang dependency…"
  pnpm install --frozen-lockfile
fi

if [ ! -f dist/index.html ]; then
  echo "[DIZA] Membuat build web…"
  pnpm build
fi

export DIZA_START_HOSTC="${DIZA_START_HOSTC:-1}"
exec node deploy/termux-hostc.mjs
