#!/usr/bin/env bash
# Stoa server installer — bootstrap the hub on a fresh machine.
#
#   curl -fsSL https://raw.githubusercontent.com/asharijuang/stoa/master/install.sh | bash
#   # or, from a clone:
#   ./install.sh
#
# Auto-detects the OS (Linux / macOS / Windows-via-WSL or Git Bash), checks
# prerequisites, fetches the code, installs deps, then runs `node cli.js install`
# which links the `stoa` command and enables the background gateway service.
#
# Native Windows (PowerShell, no bash): use install.ps1 instead:
#   irm https://raw.githubusercontent.com/asharijuang/stoa/master/install.ps1 | iex

set -e

REPO_URL="${STOA_REPO_URL:-https://github.com/asharijuang/stoa}"
INSTALL_DIR="${STOA_DIR:-$HOME/stoa}"

# ── Detect OS ──────────────────────────────────────────────────────────────────
case "$(uname -s)" in
  Linux*)               OS=linux ;;
  Darwin*)              OS=mac ;;
  MINGW*|MSYS*|CYGWIN*) OS=windows ;;
  *)                    OS=unknown ;;
esac
echo "=== Stoa installer ==="
echo "OS detected: ${OS}"

if [ "$OS" = "windows" ]; then
  echo "  (running under a bash shell on Windows — WSL works fully; native Git Bash"
  echo "   can't manage a background service. For native Windows use install.ps1.)"
elif [ "$OS" = "unknown" ]; then
  echo "  Unsupported OS. Proceeding anyway, but the gateway service may not install."
fi

# ── Check prerequisites ──────────────────────────────────────────────────────────
for cmd in git node npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: '$cmd' not found. Install it first:"
    echo "  - Node.js 20+ (includes npm): https://nodejs.org/"
    echo "  - git: https://git-scm.com/"
    exit 1
  fi
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node 20+ required (found $(node -v)). Upgrade Node and re-run."
  exit 1
fi
echo "ok: node $(node -v), npm $(npm -v), git present"

# ── Get the code ────────────────────────────────────────────────────────────────
# If run from inside a checkout, use it. Otherwise clone (or update) into INSTALL_DIR.
if [ -f "./cli.js" ] && [ -f "./server.js" ]; then
  INSTALL_DIR="$(pwd)"
  echo "[1/3] Using current checkout: ${INSTALL_DIR}"
elif [ -d "${INSTALL_DIR}/.git" ]; then
  echo "[1/3] Updating existing clone: ${INSTALL_DIR}"
  git -C "${INSTALL_DIR}" pull --ff-only || echo "  (pull skipped — local changes)"
  cd "${INSTALL_DIR}"
else
  echo "[1/3] Cloning ${REPO_URL} → ${INSTALL_DIR}"
  git clone "${REPO_URL}" "${INSTALL_DIR}"
  cd "${INSTALL_DIR}"
fi

# ── Install dependencies ──────────────────────────────────────────────────────────
echo "[2/3] Installing dependencies (npm install)…"
npm install --no-audit --no-fund

# ── Bootstrap: link the `stoa` command + enable the gateway ───────────────────────
echo "[3/3] Bootstrapping (link command + enable gateway)…"
node cli.js install

echo ""
echo "=== Done ==="
echo "Open the dashboard:  stoa dashboard"
echo "Check status:        stoa gateway status"
echo "Stop the server:     stoa gateway stop"
echo ""
echo "If 'stoa' isn't found, restart your shell or run: npm link  (from ${INSTALL_DIR})"
