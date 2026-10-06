#!/usr/bin/env bash
# One-time (idempotent) setup: dependencies, Python venv, Ollama + Sheru models, extension build, desktop buddy.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/lib.sh"

DEV=0; SKIP_MODEL=0; WITH_ENV=0
usage() {
  cat <<USAGE
Usage: ./setup.sh [--dev] [--skip-model] [--with-env] [-h|--help]

  --dev          also install pulse-backend/requirements-dev.txt (pytest etc.)
  --skip-model   do not check/pull the Ollama model
  --with-env     copy .env.example -> .env files (defaults already work without them)
  -h, --help     show this help

Env (export in your shell):
  LLM_MODEL    model to pull AND to build into the extension (VITE_LLM_MODEL); default $DEFAULT_MODEL
               (if unset, the extension uses VITE_LLM_MODEL from the environment/extension/.env, else its default)
  OLLAMA_URL   Ollama endpoint for the model check (default http://localhost:11434)
USAGE
}
for a in "$@"; do
  case "$a" in
    --dev) DEV=1 ;; --skip-model) SKIP_MODEL=1 ;; --with-env) WITH_ENV=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $a" ;;
  esac
done

MODEL="${LLM_MODEL:-$DEFAULT_MODEL}"
SUMMARY=""
add() { SUMMARY="$SUMMARY
  $1"; }

# ---- Node ---------------------------------------------------------------------
require_cmd node "Install Node 20.19+ (or 22.12+) from https://nodejs.org"
require_cmd npm
NODE_V="$(node -v)"
node_version_ok "$NODE_V" || die "Node $NODE_V is not supported; Vite needs ^20.19.0 or >=22.12.0 (21.x and 22.0-22.11 do not work)."
ok "Node $NODE_V, npm $(npm -v)"
add "Node $NODE_V"

# ---- Python venv ----------------------------------------------------------------
pip_install() { # pip_install <requirements file>
  if [ "$USE_UV" -eq 1 ]; then
    "$UV" pip install -q -r "$1" --python "$VENV_DIR/bin/python"
  else
    "$VENV_DIR/bin/python" -m pip install -q -r "$1"
  fi
}

UV=""; USE_UV=0
if UV="$(find_uv)"; then USE_UV=1; fi

venv_ok=0
if [ -x "$VENV_DIR/bin/python" ]; then
  v="$(python_version "$VENV_DIR/bin/python" || true)"
  if [ -n "$v" ] && version_ge "$v" 3.10; then venv_ok=1; else warn "Existing venv uses Python ${v:-?} (<3.10); recreating."; rm -rf "$VENV_DIR"; fi
fi
if [ "$venv_ok" -eq 0 ]; then
  if [ "$USE_UV" -eq 1 ]; then
    info "Creating venv with uv (Python 3.11)"
    "$UV" venv --python 3.11 "$VENV_DIR"
  else
    PY="$(find_python)" || die "Need Python >= 3.10 (or install uv: https://docs.astral.sh/uv/). Found none on PATH."
    info "Creating venv with $PY ($(python_version "$PY"))"
    "$PY" -m venv "$VENV_DIR"
  fi
fi
info "Installing backend requirements"
pip_install "$BACKEND_DIR/requirements.txt"
if [ "$DEV" -eq 1 ]; then
  info "Installing backend dev requirements"
  pip_install "$BACKEND_DIR/requirements-dev.txt"
fi
PYV="$(python_version "$VENV_DIR/bin/python")"
ok "Backend venv ready (Python $PYV, $([ "$USE_UV" -eq 1 ] && echo uv || echo pip))"
add "Backend venv: pulse-backend/.venv (Python $PYV)"

# ---- npm deps -------------------------------------------------------------------
npm_deps() { # npm_deps <dir>
  local d="$1" name; name="$(basename "$d")"
  if [ -f "$d/package-lock.json" ]; then
    if [ -f "$d/node_modules/.package-lock.json" ] && [ "$d/node_modules/.package-lock.json" -nt "$d/package-lock.json" ]; then
      ok "$name: node_modules up to date"
    else
      info "$name: npm ci"
      (cd "$d" && npm ci --no-audit --no-fund)
    fi
  else
    info "$name: npm install (no lockfile)"
    (cd "$d" && npm install --no-audit --no-fund)
  fi
}
npm_deps "$EXT_DIR"
npm_deps "$DASH_DIR"
add "npm dependencies: extension, dashboard"

# ---- .env files -----------------------------------------------------------------
if [ "$WITH_ENV" -eq 1 ]; then
  for pair in ".env.example:.env" "pulse-backend/.env.example:pulse-backend/.env" \
              "dashboard/.env.example:dashboard/.env" "extension/.env.example:extension/.env"; do
    src="$ROOT_DIR/${pair%%:*}"; dst="$ROOT_DIR/${pair##*:}"
    if [ -f "$src" ] && [ ! -f "$dst" ]; then cp "$src" "$dst"; ok "Created ${pair##*:}"
    elif [ -f "$dst" ]; then info "${pair##*:} exists; left unchanged"; fi
  done
  add ".env files created from examples (existing ones kept)"
fi

# ---- Ollama ---------------------------------------------------------------------
if [ "$SKIP_MODEL" -eq 1 ]; then
  info "Skipping Ollama model check (--skip-model)"
  add "Ollama model: skipped"
elif ! have ollama; then
  warn "Ollama not installed; the extension will use heuristic mode. Install: https://ollama.com/download"
  add "Ollama: NOT installed (optional)"
else
  TMP_OLLAMA_PID=""
  cleanup_tmp() { [ -n "$TMP_OLLAMA_PID" ] && kill "$TMP_OLLAMA_PID" 2>/dev/null || true; }
  trap cleanup_tmp EXIT
  if ! http_ok "$OLLAMA_BASE/api/tags"; then
    info "Starting a temporary Ollama server to check the model"
    mkdir -p "$LOG_DIR"
    OLLAMA_ORIGINS="chrome-extension://*" ollama serve >>"$LOG_DIR/ollama.log" 2>&1 </dev/null &
    TMP_OLLAMA_PID=$!
    wait_for_http "$OLLAMA_BASE/api/tags" 30 || die "Ollama server did not start (see .run/logs/ollama.log)"
  fi
  want="$MODEL"; case "$want" in *:*) ;; *) want="$want:latest" ;; esac
  if ollama list 2>/dev/null | awk 'NR>1{print $1}' | grep -Fxq "$want"; then
    ok "Ollama model $MODEL already pulled"
    add "Ollama model: $MODEL (present)"
  else
    info "Pulling Ollama model $MODEL (this can take a while)"
    ollama pull "$MODEL"
    ok "Pulled $MODEL"
    add "Ollama model: $MODEL (pulled)"
  fi
  if ensure_sheru_model "$MODEL"; then
    ok "Sheru persona model ready (ollama model '$SHERU_MODEL', built on $MODEL)"
    add "Sheru model: $SHERU_MODEL (from ollama/Modelfile.sheru)"
  else
    warn "Could not build the '$SHERU_MODEL' model; Sheru will use $MODEL with the same persona prompt."
  fi
  cleanup_tmp; TMP_OLLAMA_PID=""
fi

# ---- build extension ------------------------------------------------------------
info "Building extension"
if [ -n "${LLM_MODEL:-}" ]; then
  (cd "$EXT_DIR" && VITE_LLM_MODEL="$LLM_MODEL" npm run build)
  EXT_MODEL="$LLM_MODEL"
else
  (cd "$EXT_DIR" && npm run build)
  EXT_MODEL="${VITE_LLM_MODEL:-extension/.env VITE_LLM_MODEL or built-in default}"
fi
ok "Extension built: $EXT_DIR/dist (model: $EXT_MODEL)"
add "Extension build: extension/dist (model: $EXT_MODEL)"

# ---- Sheru desktop buddy (macOS) ------------------------------------------------
if [ "$(uname -s)" = "Darwin" ]; then
  if have swiftc; then
    info "Building Sheru's desktop app (Lighthouse Buddy.app)"
    if "$BUDDY_DIR/build.sh"; then
      add "Desktop buddy: buddy/build/Lighthouse Buddy.app"
    else
      warn "Could not build the desktop buddy; Lighthouse still works in the browser."
      add "Desktop buddy: build FAILED (see output above)"
    fi
  else
    warn "swiftc not found: install the Xcode Command Line Tools (xcode-select --install) to get Sheru on your desktop."
    add "Desktop buddy: skipped (no swiftc)"
  fi
fi

printf '\n%sSetup complete%s%s\n\nNext: ./start.sh\n' "$C_BOLD" "$C_RESET" "$SUMMARY"
