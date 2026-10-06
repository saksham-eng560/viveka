#!/usr/bin/env bash
# Start Ollama (if needed), ActivityWatch (if installed), the Pulse backend and the dashboard.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/lib.sh"

DETACH=0; OPEN=1; FIX_OLLAMA=0; YES=0
usage() {
  cat <<USAGE
Usage: ./start.sh [--detach|-d] [--no-open] [--fix-ollama [-y|--yes]] [-h|--help]

  -d, --detach    start services and return; stop later with ./stop.sh
  --no-open       do not open the dashboard in a browser
  --fix-ollama    (macOS) set OLLAMA_ORIGINS persistently (launchctl setenv), quit the
                  Ollama app, stop running "ollama serve" processes, relaunch Ollama.
                  Asks [y/N] first. Undo: launchctl unsetenv OLLAMA_ORIGINS
  -y, --yes       answer yes to the --fix-ollama prompt (required without a TTY)
  -h, --help      show this help

--fix-ollama and the local "ollama serve" start only apply to a local Ollama; they are
refused/skipped when OLLAMA_URL points at another host.

Default: run in the foreground, tail logs, Ctrl+C stops everything started.
Env (export in your shell; not read from .env files by this script):
  LLM_MODEL        backend model; only passed to the backend if set
                   (otherwise pulse-backend/.env or the built-in $DEFAULT_MODEL applies)
  BACKEND_PORT (default 8000), DASHBOARD_PORT (default 3000)
  OLLAMA_URL (default http://localhost:11434), AW_SERVER_URL (default http://localhost:5600)
                   used for the readiness probes here; the backend reads its own .env
USAGE
}
for a in "$@"; do
  case "$a" in
    -d|--detach) DETACH=1 ;; --no-open) OPEN=0 ;; --fix-ollama) FIX_OLLAMA=1 ;;
    -y|--yes) YES=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $a" ;;
  esac
done
if [ "$FIX_OLLAMA" -eq 1 ] && ! ollama_is_local; then
  die "--fix-ollama only applies to a local Ollama; OLLAMA_URL ($OLLAMA_BASE) points to another host. Nothing was changed."
fi
if [ "$FIX_OLLAMA" -eq 1 ] && [ "$YES" -eq 0 ] && [ ! -t 0 ]; then
  die "--fix-ollama needs confirmation but stdin is not a terminal; re-run with --yes"
fi

BACKEND_PORT="${BACKEND_PORT:-8000}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3000}"
AW_URL="${AW_SERVER_URL:-http://localhost:5600}"
ORIGIN="chrome-extension://$EXTENSION_ID"
CORS_STATE="unknown"

# ---- dependencies ---------------------------------------------------------------
if [ ! -d "$EXT_DIR/node_modules" ] || [ ! -d "$DASH_DIR/node_modules" ] \
   || [ ! -x "$VENV_DIR/bin/uvicorn" ] || [ ! -d "$EXT_DIR/dist" ]; then
  info "Dependencies missing; running ./setup.sh first"
  "$ROOT_DIR/setup.sh"
fi
require_cmd curl
require_cmd lsof
mkdir -p "$LOG_DIR"

# ---- ollama ---------------------------------------------------------------------
cors_status() { # echoes HTTP status of the extension-origin preflight
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X OPTIONS \
    -H "Origin: $ORIGIN" -H "Access-Control-Request-Method: POST" \
    "$OLLAMA_BASE/api/generate" 2>/dev/null || true
}

check_cors() {
  local code; code="$(cors_status)"
  case "$code" in
    200|204) CORS_STATE="ok"; ok "Ollama accepts requests from the extension origin (HTTP $code)" ;;
    *) CORS_STATE="blocked"
       warn "Ollama rejected the extension origin (HTTP ${code:-none}). The extension will run in heuristic mode (no LLM)."
       warn "Fix: launchctl setenv OLLAMA_ORIGINS \"chrome-extension://*\", then quit and reopen the Ollama app"
       warn "     (or just run: ./start.sh --fix-ollama). If you run 'ollama serve' yourself, start it with"
       warn "     OLLAMA_ORIGINS=\"chrome-extension://*\" ollama serve" ;;
  esac
}

STARTED_NOW=""   # services started by this invocation (failure cleanup only touches these)
started() { STARTED_NOW="$STARTED_NOW $1"; }
stop_started() { local n; for n in $STARTED_NOW; do stop_service "$n"; done; }

# ollama_serve_pids: pids of processes whose executable is ollama and that run "serve"
ollama_serve_pids() {
  local p c
  for p in $(pgrep -x ollama 2>/dev/null || true); do
    c="$(ps -p "$p" -o command= 2>/dev/null || true)"
    case "$c" in *" serve"*) echo "$p" ;; esac
  done
}

start_ollama_serve() {
  if ! ollama_is_local; then warn "OLLAMA_URL ($OLLAMA_BASE) is not local; not starting a local ollama serve"; return 1; fi
  info "Starting ollama serve (OLLAMA_ORIGINS=chrome-extension://*)"
  start_bg ollama "$ROOT_DIR" env OLLAMA_ORIGINS="chrome-extension://*" ollama serve
  started ollama
}

fix_ollama() {
  if [ "$(uname -s)" != "Darwin" ]; then
    warn "--fix-ollama is macOS only. Start Ollama with: OLLAMA_ORIGINS=\"chrome-extension://*\" ollama serve"
    return 0
  fi
  local p
  info "--fix-ollama will:"
  info "  1. run: launchctl setenv OLLAMA_ORIGINS \"chrome-extension://*\"  (persists until logout/reboot or unset)"
  info "  2. quit the Ollama app (osascript)"
  info "  3. stop any remaining 'ollama serve' process (listed below)"
  info "  4. relaunch Ollama (app if installed, else 'ollama serve')"
  info "  Undo: launchctl unsetenv OLLAMA_ORIGINS"
  for p in $(ollama_serve_pids); do printf '  matching PID %s: %s\n' "$p" "$(ps -p "$p" -o command= 2>/dev/null || true)"; done
  if [ "$YES" -ne 1 ]; then
    local ans=""
    printf 'Proceed? [y/N] '
    read -r ans || ans=""
    case "$ans" in y|Y|yes|YES) ;; *) warn "Skipped --fix-ollama (not confirmed)"; check_cors; return 0 ;; esac
  fi
  launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
  osascript -e 'quit app "Ollama"' >/dev/null 2>&1 || true
  stop_service ollama
  local i=0
  # the app quitting normally stops its server; only signal what is still serving
  while [ -n "$(ollama_serve_pids)" ] && [ "$i" -lt 10 ]; do sleep 1; i=$((i + 1)); done
  for p in $(ollama_serve_pids); do info "Stopping leftover ollama serve (pid $p)"; kill "$p" 2>/dev/null || true; done
  i=0
  while http_ok "$OLLAMA_BASE/api/tags" && [ "$i" -lt 15 ]; do sleep 1; i=$((i + 1)); done
  if [ -d /Applications/Ollama.app ] && open -a Ollama 2>/dev/null; then
    info "Relaunched the Ollama app"
  else
    start_ollama_serve || true
  fi
  if ! wait_for_http "$OLLAMA_BASE/api/tags" 30; then
    warn "Ollama did not come back on $OLLAMA_BASE; trying ollama serve directly"
    start_ollama_serve || return 0
    wait_for_http "$OLLAMA_BASE/api/tags" 30 || { warn "Ollama still unreachable (see .run/logs/ollama.log)"; return 0; }
  fi
  check_cors
}

OLLAMA_STATE="not installed"
if http_ok "$OLLAMA_BASE/api/tags"; then
  OLLAMA_STATE="running"
  info "Ollama already running at $OLLAMA_BASE"
  if [ "$FIX_OLLAMA" -eq 1 ]; then fix_ollama; else check_cors; fi
elif ! ollama_is_local; then
  warn "Ollama not reachable at $OLLAMA_BASE (non-local host; not starting a local server). The extension will run in heuristic mode."
  OLLAMA_STATE="unreachable (remote)"
elif have ollama; then
  start_ollama_serve || true
  if wait_for_http "$OLLAMA_BASE/api/tags" 30; then OLLAMA_STATE="started by start.sh"; check_cors
  else warn "Ollama did not become reachable (see .run/logs/ollama.log); continuing without it"; OLLAMA_STATE="failed to start"; stop_service ollama; fi
else
  warn "Ollama not installed; the extension will run in heuristic mode. Install: https://ollama.com/download"
fi

# ---- ActivityWatch --------------------------------------------------------------
AW_STATE="not running"
if http_ok "$AW_URL/api/0/info"; then
  AW_STATE="running"; ok "ActivityWatch reachable at $AW_URL"
else
  AW_BIN=""
  for c in aw-server-rust aw-server; do have "$c" && { AW_BIN="$c"; break; }; done
  if [ -n "$AW_BIN" ]; then
    info "Starting $AW_BIN"
    start_bg aw-server "$ROOT_DIR" "$AW_BIN"
    started aw-server
    if wait_for_http "$AW_URL/api/0/info" 20; then AW_STATE="started by start.sh"; else warn "$AW_BIN did not come up"; AW_STATE="failed to start"; stop_service aw-server; fi
  else
    info "ActivityWatch not found; the backend will use sample data (this is fine for a demo)."
  fi
fi

# ---- backend + dashboard --------------------------------------------------------
fail_start() { # fail_start <name> <msg>
  err "$2"
  if [ -f "$LOG_DIR/$1.log" ]; then echo "--- last 20 lines of .run/logs/$1.log ---" >&2; tail -n 20 "$LOG_DIR/$1.log" >&2; fi
  stop_started
  exit 1
}

ensure_port() { # ensure_port <service> <port>; returns 0 if free, 10 if already ours
  if service_running "$1"; then return 10; fi
  if port_in_use "$2"; then
    err "Port $2 is already in use by another process:"
    describe_port_users "$2" >&2
    err "Free it, or choose another port (BACKEND_PORT / DASHBOARD_PORT)."
    stop_started; exit 1
  fi
  return 0
}

rc=0; ensure_port backend "$BACKEND_PORT" || rc=$?
if [ "$rc" -eq 10 ]; then info "Backend already running (pid $(read_pid backend))"
else
  info "Starting backend on 127.0.0.1:$BACKEND_PORT"
  start_bg backend "$BACKEND_DIR" .venv/bin/uvicorn main:app --host 127.0.0.1 --port "$BACKEND_PORT"
  started backend
fi
wait_for_http "http://127.0.0.1:$BACKEND_PORT/api/health" 30 || fail_start backend "Backend did not become healthy within 30s"
ok "Backend healthy"

export VITE_API_URL="http://localhost:$BACKEND_PORT"
rc=0; ensure_port dashboard "$DASHBOARD_PORT" || rc=$?
if [ "$rc" -eq 10 ]; then info "Dashboard already running (pid $(read_pid dashboard))"
else
  info "Starting dashboard on 127.0.0.1:$DASHBOARD_PORT"
  start_bg dashboard "$DASH_DIR" npm run dev -- --host 127.0.0.1 --port "$DASHBOARD_PORT" --strictPort
  started dashboard
fi
wait_for_http "http://127.0.0.1:$DASHBOARD_PORT" 30 || fail_start dashboard "Dashboard did not come up within 30s"
ok "Dashboard up"

# ---- summary --------------------------------------------------------------------
HEALTH="$(curl -fsS --max-time 5 "http://127.0.0.1:$BACKEND_PORT/api/health" 2>/dev/null || true)"
HEALTH_LINE="$("$VENV_DIR/bin/python" -c '
import json, sys
d = json.loads(sys.stdin.read())
o, a = d["ollama"], d["aw"]
print("ActivityWatch reachable: %s | Ollama reachable: %s | model available: %s (%s)" % (a["reachable"], o["reachable"], o["modelAvailable"] if "modelAvailable" in o else o.get("model_available"), o["model"]))
' <<<"$HEALTH" 2>/dev/null || echo "health JSON unavailable")"

line() { printf '%s|%s %s\n' "$C_BOLD" "$C_RESET" "$*"; }
bar="+------------------------------------------------------------------------------"
printf '\n%s%s%s\n' "$C_BOLD" "$bar" "$C_RESET"
line "${C_BOLD}Lighthouse is running${C_RESET}"
line ""
line "Dashboard : http://localhost:$DASHBOARD_PORT"
line "API docs  : http://localhost:$BACKEND_PORT/docs"
line "Health    : $HEALTH_LINE"
line "Ollama    : $OLLAMA_STATE; extension CORS: $CORS_STATE"
line "ActivityWatch: $AW_STATE$([ "$AW_STATE" = "not running" ] && echo ' (backend uses sample data)')"
line ""
line "Load the extension:"
line "  1. Open chrome://extensions and enable Developer mode"
line "  2. Load unpacked -> $EXT_DIR/dist"
line "     (extension ID: $EXTENSION_ID)"
line "  3. Click the Lighthouse icon -> Open side panel; toggle Demo mode"
line ""
line "Logs: $LOG_DIR/{backend,dashboard,ollama}.log"
if [ "$DETACH" -eq 1 ]; then line "Stop with: ./stop.sh"; else line "Press Ctrl+C to stop everything"; fi
printf '%s%s%s\n\n' "$C_BOLD" "$bar" "$C_RESET"

if [ "$OPEN" -eq 1 ]; then
  case "$(uname -s)" in
    Darwin) open "http://localhost:$DASHBOARD_PORT" >/dev/null 2>&1 || true ;;
    *) have xdg-open && { xdg-open "http://localhost:$DASHBOARD_PORT" >/dev/null 2>&1 || true; } ;;
  esac
fi

[ "$DETACH" -eq 1 ] && exit 0

# ---- foreground mode ------------------------------------------------------------
TAIL_PID=""
on_exit() {
  local rc=$?
  trap '' INT TERM          # a second Ctrl+C must not abort the cleanup
  set +e
  [ -n "$TAIL_PID" ] && kill "$TAIL_PID" 2>/dev/null
  echo; info "Stopping services"
  stop_all
  exit "$rc"
}
trap 'exit 130' INT
trap 'exit 143' TERM
trap on_exit EXIT
touch "$LOG_DIR/backend.log" "$LOG_DIR/dashboard.log" "$LOG_DIR/ollama.log"
tail -n 0 -F "$LOG_DIR/backend.log" "$LOG_DIR/dashboard.log" "$LOG_DIR/ollama.log" 2>/dev/null &
TAIL_PID=$!
disown "$TAIL_PID" 2>/dev/null || true
while true; do
  service_running backend || { err "Backend exited unexpectedly"; tail -n 20 "$LOG_DIR/backend.log" >&2; exit 1; }
  service_running dashboard || { err "Dashboard exited unexpectedly"; tail -n 20 "$LOG_DIR/dashboard.log" >&2; exit 1; }
  sleep 2
done
