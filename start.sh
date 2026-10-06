#!/usr/bin/env bash
# Start everything for Lighthouse: Ollama (+ the "sheru" persona model), ActivityWatch (if installed),
# the backend (Sheru's brain), the dashboard, Sheru on your desktop (macOS) and a browser window
# with the Lighthouse extension already installed.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/lib.sh"

DETACH=0; OPEN=1; FIX_OLLAMA=0; YES=0; AW_WATCHERS=auto   # auto | yes | no
BUDDY=1; BROWSER=1; FRESH=0
usage() {
  cat <<USAGE
Usage: ./start.sh [--detach|-d] [--no-open] [--no-buddy] [--no-browser] [--fresh]
                   [--fix-ollama [-y|--yes]] [--aw-watchers|--no-aw-watchers] [-h|--help]

  -d, --detach    start services and return; stop later with ./stop.sh
  --no-open       do not open any browser window
  --no-buddy      do not start Sheru on the desktop (macOS)
  --no-browser    do not open the Lighthouse browser window with the extension installed
                  (the dashboard opens in your default browser instead)
  --fresh         forget the saved profile so onboarding starts again (activity history is kept)
  --fix-ollama    (macOS) set OLLAMA_ORIGINS persistently (launchctl setenv), quit the
                  Ollama app, stop running "ollama serve" processes, relaunch Ollama.
                  Asks [y/N] first. Undo: launchctl unsetenv OLLAMA_ORIGINS
  -y, --yes       answer yes to the --fix-ollama prompt (required without a TTY)
  --aw-watchers   also start the ActivityWatch window/AFK watchers when ActivityWatch
                  was already running (default: only when the server was started by
                  ./start.sh, now or earlier). May duplicate watchers if ActivityWatch.app /
                  aw-qt (or another launcher) already runs them.
  --no-aw-watchers  never start the window/AFK watchers (they record the active app, full
                  window titles and input-activity state into the local aw-server database)
  -h, --help      show this help

ActivityWatch: if nothing answers on AW_SERVER_URL, ./start.sh looks for an install
(AW_HOME, PATH, /Applications/ActivityWatch.app, ~/Downloads/activitywatch, ~/activitywatch,
/Applications/activitywatch, ~/Applications/activitywatch) and starts aw-server-rust plus
aw-watcher-window and aw-watcher-afk itself (no aw-qt needed). Only for a local
AW_SERVER_URL. An AW_HOME without a server is warned about and ignored (next candidate used).

--fix-ollama and the local "ollama serve" start only apply to a local Ollama; they are
refused/skipped when OLLAMA_URL points at another host.

Default: run in the foreground, tail logs, Ctrl+C stops everything started.
Env (export in your shell; not read from .env files by this script):
  LIGHTHOUSE_BROWSER  chrome | brave | edge | chromium | /path/to/browser (default: first installed)
  LLM_MODEL        backend model; only passed to the backend if set
                   (otherwise pulse-backend/.env or the built-in $DEFAULT_MODEL applies)
  BACKEND_PORT (default 8000), DASHBOARD_PORT (default 3000)
  AW_HOME          directory holding the aw-server-rust/, aw-watcher-window/, aw-watcher-afk/
                   folders (or an ActivityWatch.app, its Contents/MacOS dir, or the server binary
                   itself); checked first
  OLLAMA_URL (default http://localhost:11434), AW_SERVER_URL (default http://localhost:5600)
                   used for the readiness probes here; the backend reads its own .env
USAGE
}
for a in "$@"; do
  case "$a" in
    -d|--detach) DETACH=1 ;; --no-open) OPEN=0 ;; --fix-ollama) FIX_OLLAMA=1 ;;
    -y|--yes) YES=1 ;;
    --aw-watchers) AW_WATCHERS=yes ;; --no-aw-watchers) AW_WATCHERS=no ;;
    --no-buddy) BUDDY=0 ;; --no-browser) BROWSER=0 ;; --fresh) FRESH=1 ;;
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

# A stale extension build (sources newer than dist) is rebuilt, so the browser never loads old code.
ext_stale() {
  [ -f "$EXT_DIR/dist/manifest.json" ] || return 0
  [ -n "$(find "$EXT_DIR/src" "$EXT_DIR/vite.config.ts" "$EXT_DIR/package.json" "$BUDDY_DIR/web/sheru.svg" \
          -type f -newer "$EXT_DIR/dist/manifest.json" -print 2>/dev/null | head -n 1)" ]
}
if ext_stale; then
  info "Extension sources changed; rebuilding extension/dist"
  if [ -n "${LLM_MODEL:-}" ]; then (cd "$EXT_DIR" && VITE_LLM_MODEL="$LLM_MODEL" npm run build >"$LOG_DIR/extension-build.log" 2>&1)
  else (cd "$EXT_DIR" && npm run build >"$LOG_DIR/extension-build.log" 2>&1); fi \
    || { tail -n 20 "$LOG_DIR/extension-build.log" >&2; die "Extension build failed (see .run/logs/extension-build.log)"; }
  ok "Extension rebuilt"
fi

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
stop_started() { # reverse start order: watchers/dashboard before the server they talk to
  local n list=""
  for n in $STARTED_NOW; do list="$n $list"; done
  for n in $list; do stop_service "$n"; done
}

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
AW_STATE="not running"; AW_BIN=""; AW_DIR=""; AW_CORS="unknown"; AW_WATCHER_STATE="not started"
AW_PORT="${AW_URL#*://}"; AW_PORT="${AW_PORT%%/*}"
case "$AW_PORT" in *:*) AW_PORT="${AW_PORT##*:}" ;; *) AW_PORT=5600 ;; esac
case "$AW_PORT" in ''|*[!0-9]*) AW_PORT=5600 ;; esac
AW_STARTED=0   # 1 when aw-server is ours (started now, or by an earlier ./start.sh run)
AW_REMOTE=0
if ! aw_is_local "$AW_URL"; then AW_REMOTE=1; fi
AW_HOME_CHECKED=0

aw_data_dir() {
  if [ "$(uname -s)" = "Darwin" ]; then echo "$HOME/Library/Application Support/activitywatch/aw-server-rust/"
  else echo "$HOME/.local/share/activitywatch/aw-server-rust/"; fi
}

aw_cors_config_path() {
  if [ "$(uname -s)" = "Darwin" ]; then echo "$HOME/Library/Application Support/activitywatch/aw-server-rust/config.toml"
  else echo "$HOME/.config/activitywatch/aw-server-rust/config.toml"; fi
}

# hint_cors_regex_string: aw-server-rust 0.14 needs cors_regex to be a list; a string breaks it
hint_cors_regex_string() {
  local f; f="$(aw_cors_config_path)"
  [ -f "$f" ] || return 0
  if grep -Eq '^[[:space:]]*cors_regex[[:space:]]*=[[:space:]]*"' "$f" 2>/dev/null; then
    warn "$f has cors_regex as a string; aw-server-rust needs a LIST (otherwise: invalid type: string, expected a sequence). Change it to (not edited automatically):"
    warn "  cors_regex = [\"$ORIGIN\"]"
  fi
}

check_aw_cors() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X OPTIONS \
    -H "Origin: $ORIGIN" -H "Access-Control-Request-Method: POST" \
    "$AW_URL/api/0/buckets/aw-watcher-web-lighthouse/heartbeat" 2>/dev/null || true)"
  case "$code" in
    2??) AW_CORS="ok"; ok "ActivityWatch accepts the extension origin (extension CORS: ok)" ;;
    *) AW_CORS="blocked"
       warn "ActivityWatch rejected the extension origin (HTTP ${code:-none}); the extension cannot write to ActivityWatch."
       warn "Add this line to $(aw_cors_config_path) and restart aw-server:"
       warn "  cors_regex = [\"$ORIGIN\"]" ;;
  esac
}

aw_hint_quarantine() { # aw_hint_quarantine <bin> <dir>
  if has_quarantine "$1" || has_quarantine "$2"; then
    warn "macOS quarantine is set on the ActivityWatch download and may be killing it (exit 137). Clear it (not done automatically):"
    warn "  xattr -dr com.apple.quarantine \"$2\""
  fi
}

start_aw_watcher() { # start_aw_watcher <name>
  local name="$1" bin
  if service_running "$name"; then info "$name already running (pid $(read_pid "$name"))"; return 0; fi
  bin="$(aw_find_bin "$AW_DIR" "$name" || true)"
  if [ -z "$bin" ]; then warn "$name not found in ${AW_DIR:-PATH}; skipping"; return 0; fi
  info "Starting $name"
  start_bg_supervised "$name" "$ROOT_DIR" "$bin" --port "$AW_PORT"
  started "$name"
}

# warn_bad_aw_home: once, when AW_HOME is set but yields no server; names the fallback
warn_bad_aw_home() { # warn_bad_aw_home <fallback dir or empty>
  [ "$AW_HOME_CHECKED" -eq 0 ] || return 0
  AW_HOME_CHECKED=1
  [ -n "${AW_HOME:-}" ] || return 0
  aw_resolve_home >/dev/null && return 0
  if [ -n "${1:-}" ]; then
    warn "AW_HOME ($AW_HOME) contains no ActivityWatch server (aw-server-rust/aw-server); IGNORING it and using $1 instead."
  else
    warn "AW_HOME ($AW_HOME) contains no ActivityWatch server (aw-server-rust/aw-server); ignoring it and no other install was found."
  fi
}

if http_ok "$AW_URL/api/0/info"; then
  AW_STATE="running"; ok "ActivityWatch reachable at $AW_URL"
  if service_running aw-server; then AW_STARTED=1; AW_STATE="running (started by an earlier ./start.sh)"; fi
elif [ "$AW_REMOTE" -eq 1 ]; then
  warn "ActivityWatch not reachable at $AW_URL (non-local host; not starting a local server or watchers). The backend will use sample data."
  AW_STATE="unreachable (remote)"
else
  AW_DIR="$(find_activitywatch_dir || true)"
  warn_bad_aw_home "${AW_DIR:-}"
  if [ -n "$AW_DIR" ]; then
    AW_BIN="$(aw_bin_in_dir "$AW_DIR" aw-server-rust || aw_bin_in_dir "$AW_DIR" aw-server || true)"
  else
    for c in aw-server-rust aw-server; do have "$c" && { AW_BIN="$(command -v "$c")"; break; }; done
  fi
  if [ -n "$AW_BIN" ]; then
    case "$(basename "$AW_BIN")" in
      aw-server) warn "Only the Python aw-server was found ($AW_BIN); it does not support cors_regex, so the Lighthouse extension may be blocked. Install aw-server-rust (the official ActivityWatch.app/download includes it)." ;;
    esac
    info "Found ActivityWatch: ${AW_DIR:-PATH} (server: $AW_BIN)"
    info "Starting $(basename "$AW_BIN")"
    start_bg aw-server "$ROOT_DIR" "$AW_BIN" --port "$AW_PORT"
    started aw-server
    if wait_for_http "$AW_URL/api/0/info" 20; then
      AW_STATE="started by start.sh"; AW_STARTED=1
    else
      warn "$(basename "$AW_BIN") did not come up (see .run/logs/aw-server.log)"
      [ -f "$LOG_DIR/aw-server.log" ] && tail -n 10 "$LOG_DIR/aw-server.log" >&2
      aw_hint_quarantine "$AW_BIN" "${AW_DIR:-$(dirname "$AW_BIN")}"
      hint_cors_regex_string
      AW_STATE="failed to start"; stop_service aw-server
    fi
  else
    hint_cors_regex_string
    info "ActivityWatch not found (set AW_HOME, or unzip it to ~/Downloads/activitywatch or /Applications); the backend will use sample data (this is fine for a demo)."
  fi
fi

if [ "$AW_REMOTE" -eq 0 ] && { [ "${AW_STATE#running}" != "$AW_STATE" ] || [ "$AW_STARTED" -eq 1 ]; }; then
  check_aw_cors
  want_watchers=0
  case "$AW_WATCHERS" in yes) want_watchers=1 ;; auto) [ "$AW_STARTED" -eq 1 ] && want_watchers=1 ;; esac
  if [ "$want_watchers" -eq 1 ]; then
    [ -n "$AW_DIR" ] || AW_DIR="$(find_activitywatch_dir || true)"
    warn_bad_aw_home "${AW_DIR:-}"
    start_aw_watcher aw-watcher-window
    start_aw_watcher aw-watcher-afk
    # aw-watcher-afk exits ~10s after startup if it lost its parent, so wait past that
    # window and check the watcher process itself (not just its keeper shell).
    case "$STARTED_NOW" in *aw-watcher*) info "Verifying watchers stay up (12s)"; sleep 12 ;; esac
    AW_WATCHER_STATE=""
    for w in aw-watcher-window aw-watcher-afk; do
      if service_running "$w" && supervised_child_alive "$w"; then AW_WATCHER_STATE="$AW_WATCHER_STATE $w=running"
      else
        AW_WATCHER_STATE="$AW_WATCHER_STATE $w=not running"
        if [ -f "$LOG_DIR/$w.log" ]; then warn "$w is not running; last log lines:"; tail -n 5 "$LOG_DIR/$w.log" >&2; fi
        stop_service "$w"
      fi
    done
    AW_WATCHER_STATE="${AW_WATCHER_STATE# }"
    info "Watchers record the active app, full window titles and input-activity (AFK) state into the local aw-server database ($(aw_data_dir)); nothing leaves this machine. Disable: --no-aw-watchers."
    info "macOS will ask for Accessibility permission (window watcher) and Input Monitoring (afk watcher) the first time."
  elif [ "$AW_WATCHERS" = "no" ]; then AW_WATCHER_STATE="disabled (--no-aw-watchers)"
  else AW_WATCHER_STATE="not started (ActivityWatch was already running; use --aw-watchers)"; fi
elif [ "$AW_REMOTE" -eq 1 ]; then AW_WATCHER_STATE="not started (non-local AW_SERVER_URL)"
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
wait_for_http "http://127.0.0.1:$BACKEND_PORT/api/health" 30 8 || fail_start backend "Backend did not become healthy within 30s"
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

# ---- fresh start (onboarding again) ------------------------------------------------
if [ "$FRESH" -eq 1 ]; then
  if curl -fsS -X DELETE --max-time 5 "http://127.0.0.1:$BACKEND_PORT/api/profile" >/dev/null 2>&1; then
    ok "Profile cleared: onboarding will start in the dashboard"
  else warn "Could not clear the profile (backend did not answer)"; fi
fi

# ---- Sheru: persona model, desktop buddy, browser with the extension --------------------
SHERU_MODEL_STATE="not built (Ollama not reachable)"
if ollama_is_local && http_ok "$OLLAMA_BASE/api/tags"; then
  if ensure_sheru_model "${LLM_MODEL:-$DEFAULT_MODEL}"; then SHERU_MODEL_STATE="ready (ollama model '$SHERU_MODEL')"
  else SHERU_MODEL_STATE="not built (is ${LLM_MODEL:-$DEFAULT_MODEL} pulled? Sheru falls back to it)"; fi
fi

BUDDY_STATE="disabled (--no-buddy)"
if [ "$BUDDY" -eq 1 ] && [ "$(uname -s)" != "Darwin" ]; then BUDDY_STATE="macOS only (nudges appear in your browser tabs instead)"
elif [ "$BUDDY" -eq 1 ]; then
  if service_running buddy; then BUDDY_STATE="on your desktop (already running)"
  elif pgrep -f "Contents/MacOS/LighthouseBuddy" >/dev/null 2>&1; then BUDDY_STATE="already running (started outside start.sh)"
  elif ! have swiftc; then BUDDY_STATE="needs the Xcode Command Line Tools: xcode-select --install"
  elif "$BUDDY_DIR/build.sh" >"$LOG_DIR/buddy-build.log" 2>&1; then
    info "Starting Sheru on your desktop"
    start_bg buddy "$ROOT_DIR" "$BUDDY_BIN" --port "$BACKEND_PORT" --dashboard "http://localhost:$DASHBOARD_PORT"
    started buddy
    sleep 2
    if service_running buddy; then BUDDY_STATE="on your desktop (top-left corner; 🦁 in the menu bar)"
    else BUDDY_STATE="exited early (see .run/logs/buddy.log)"; warn "Sheru's desktop app exited; see .run/logs/buddy.log"; fi
  else
    BUDDY_STATE="build failed (see .run/logs/buddy-build.log)"
    warn "Could not build Sheru's desktop app; see .run/logs/buddy-build.log"
  fi
fi

BROWSER_STATE="not opened"
if [ "$OPEN" -eq 0 ]; then BROWSER_STATE="not opened (--no-open)"
elif [ "$BROWSER" -eq 0 ]; then BROWSER_STATE="disabled (--no-browser)"
elif service_running browser; then BROWSER_STATE="already open (Lighthouse window)"
else
  info "Opening a browser window with the Lighthouse extension installed"
  start_bg browser "$ROOT_DIR" node "$ROOT_DIR/scripts/launch-browser.mjs" --ext "$EXT_DIR/dist" \
    --profile "$RUN_DIR/browser-profile" --url "http://localhost:$DASHBOARD_PORT"
  started browser
  i=0
  while [ "$i" -lt 20 ] && service_running browser && ! grep -q "ready;" "$LOG_DIR/browser.log" 2>/dev/null; do sleep 1; i=$((i + 1)); done
  if grep -q "extension installed" "$LOG_DIR/browser.log" 2>/dev/null; then
    BROWSER_STATE="open, extension installed ($(sed -n 's/.*starting \([a-z]*\):.*/\1/p' "$LOG_DIR/browser.log" | head -n 1))"
  elif service_running browser; then BROWSER_STATE="open, but the extension needs a manual install (see below)"
  else
    BROWSER_STATE="could not start (see .run/logs/browser.log)"
    warn "Could not open the Lighthouse browser window:"; tail -n 5 "$LOG_DIR/browser.log" >&2 || true
  fi
fi

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
line "Sheru     : $BUDDY_STATE"
line "Browser   : $BROWSER_STATE"
line "Dashboard : http://localhost:$DASHBOARD_PORT   (onboarding opens there on first run)"
line "Sheru model: $SHERU_MODEL_STATE"
line "API docs  : http://localhost:$BACKEND_PORT/docs"
line "Health    : $HEALTH_LINE"
line "Ollama    : $OLLAMA_STATE; extension CORS: $CORS_STATE"
line "ActivityWatch: $AW_STATE$([ "$AW_STATE" = "not running" ] && echo ' (backend uses sample data)')${AW_BIN:+; binary: $AW_BIN}; extension CORS: $AW_CORS"
line "AW watchers : $AW_WATCHER_STATE"
line "  (macOS asks for Accessibility / Input Monitoring permission on first run)"
line ""
case "$BROWSER_STATE" in
  open,\ extension\ installed*) line "Extension : installed in the Lighthouse browser window (ID $EXTENSION_ID)" ;;
  *) line "Extension : to use your own browser: chrome://extensions -> Developer mode -> Load unpacked"
     line "            -> $EXT_DIR/dist   (pick the dist folder, not extension/)" ;;
esac
line "Showcase  : pick the 'Demo' pace in onboarding (or the dashboard) for fast nudges"
line ""
line "Logs: $LOG_DIR/{backend,dashboard,buddy,browser,ollama,aw-server,aw-watcher-window,aw-watcher-afk}.log"
if [ "$DETACH" -eq 1 ]; then line "Stop with: ./stop.sh"; else line "Press Ctrl+C to stop everything"; fi
printf '%s%s%s\n\n' "$C_BOLD" "$bar" "$C_RESET"

if [ "$OPEN" -eq 1 ] && ! service_running browser; then
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
trap 'exit 129' HUP   # Terminal window closed (e.g. Lighthouse.command): still clean up
trap on_exit EXIT
touch "$LOG_DIR/backend.log" "$LOG_DIR/dashboard.log" "$LOG_DIR/ollama.log" "$LOG_DIR/buddy.log" "$LOG_DIR/browser.log"
tail -n 0 -F "$LOG_DIR/backend.log" "$LOG_DIR/dashboard.log" "$LOG_DIR/ollama.log" "$LOG_DIR/buddy.log" "$LOG_DIR/browser.log" 2>/dev/null &
TAIL_PID=$!
disown "$TAIL_PID" 2>/dev/null || true
while true; do
  service_running backend || { err "Backend exited unexpectedly"; tail -n 20 "$LOG_DIR/backend.log" >&2; exit 1; }
  service_running dashboard || { err "Dashboard exited unexpectedly"; tail -n 20 "$LOG_DIR/dashboard.log" >&2; exit 1; }
  sleep 2
done
