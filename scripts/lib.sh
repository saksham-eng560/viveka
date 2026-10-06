#!/usr/bin/env bash
# Shared helpers for setup.sh / start.sh / stop.sh / test.sh (bash 3.2 compatible).
# Meant to be sourced, not executed.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$RUN_DIR/logs"
EXT_DIR="$ROOT_DIR/extension"
DASH_DIR="$ROOT_DIR/dashboard"
BACKEND_DIR="$ROOT_DIR/pulse-backend"
VENV_DIR="$BACKEND_DIR/.venv"

EXTENSION_ID="edaacbpplacmlbfilkabahkcmhopmpdj"
DEFAULT_MODEL="qwen3.5:4b"
OLLAMA_BASE="${OLLAMA_URL:-http://localhost:11434}"
OLLAMA_BASE="${OLLAMA_BASE%/}"
# When OLLAMA_URL is overridden, point the ollama CLI/server at the same host:port.
if [ -n "${OLLAMA_URL:-}" ]; then
  OLLAMA_HOST="${OLLAMA_BASE#*://}"; OLLAMA_HOST="${OLLAMA_HOST%%/*}"
  export OLLAMA_HOST
fi
# ollama_is_local: success when the Ollama URL host is this machine
ollama_is_local() {
  local h="${OLLAMA_BASE#*://}"
  h="${h%%/*}"
  case "$h" in
    \[*\]*) h="${h%%\]*}]" ;;   # [::1] or [::1]:port
    *) h="${h%%:*}" ;;
  esac
  case "$h" in localhost|127.0.0.1|"[::1]"|::1) return 0 ;; *) return 1 ;; esac
}

# aw_is_local: success when the ActivityWatch URL host ($1) is this machine
aw_is_local() {
  local h="${1#*://}"
  h="${h%%/*}"
  case "$h" in
    \[*\]*) h="${h%%\]*}]" ;;
    *) h="${h%%:*}" ;;
  esac
  case "$h" in localhost|127.0.0.1|"[::1]"|::1) return 0 ;; *) return 1 ;; esac
}

# ---- colors (off when not a TTY or NO_COLOR is set) -------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_RESET=""
fi

info() { printf '%s[info]%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
ok()   { printf '%s[ ok ]%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s[warn]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()  { printf '%s[fail]%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
die()  { err "$*"; exit 1; }

# ---- checks -------------------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

require_cmd() { # require_cmd <cmd> [hint]
  have "$1" || die "'$1' is required but was not found on PATH.${2:+ $2}"
}

# node_version_ok V -> success when V satisfies Vite's range ^20.19.0 || >=22.12.0
node_version_ok() {
  local v="${1#v}" major minor
  major="${v%%.*}"; minor="${v#*.}"; minor="${minor%%.*}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  case "$minor" in ''|*[!0-9]*) minor=0 ;; esac
  [ "$major" -eq 20 ] && [ "$minor" -ge 19 ] && return 0
  [ "$major" -eq 22 ] && [ "$minor" -ge 12 ] && return 0
  [ "$major" -ge 23 ] && return 0
  return 1
}

# version_ge A B -> success when dotted version A >= B (numeric, up to 3 parts)
version_ge() {
  local a="${1#v}" b="${2#v}" i x y
  local IFS=.
  set -- $a; local a1="${1:-0}" a2="${2:-0}" a3="${3:-0}"
  set -- $b; local b1="${1:-0}" b2="${2:-0}" b3="${3:-0}"
  for i in 1 2 3; do
    eval "x=\$a$i; y=\$b$i"
    x="${x%%[!0-9]*}"; y="${y%%[!0-9]*}"
    x="${x:-0}"; y="${y:-0}"
    [ "$x" -gt "$y" ] && return 0
    [ "$x" -lt "$y" ] && return 1
  done
  return 0
}

# ---- ports --------------------------------------------------------------------
port_pids() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | sort -u || true; }
port_in_use() { [ -n "$(port_pids "$1")" ]; }
describe_port_users() { # prints "PID (command)" lines
  local p
  for p in $(port_pids "$1"); do
    printf '  PID %s (%s):\n    %s\n' "$p" "$(ps -p "$p" -o comm= 2>/dev/null || true)" "$(ps -p "$p" -o command= 2>/dev/null || true)"
  done
}

# ---- http ---------------------------------------------------------------------
http_ok() { curl -fsS -o /dev/null --max-time "${2:-2}" "$1" >/dev/null 2>&1; }   # http_ok <url> [max_seconds]

wait_for_http() { # wait_for_http <url> [timeout_seconds] [per_probe_max_seconds]
  local url="$1" timeout="${2:-30}" probe="${3:-2}" i=0
  while [ "$i" -lt "$timeout" ]; do
    http_ok "$url" "$probe" && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}

# ---- uv / python discovery ----------------------------------------------------
find_uv() {
  local c
  if have uv; then command -v uv; return 0; fi
  for c in "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv"; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}

python_version() { "$1" -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])' 2>/dev/null; }

# find_python -> echoes path of a python >= 3.10
find_python() {
  local c p v
  for c in python3.13 python3.12 python3.11 python3.10 python3; do
    p="$(command -v "$c" 2>/dev/null || true)"
    [ -n "$p" ] || continue
    v="$(python_version "$p" || true)"
    [ -n "$v" ] && version_ge "$v" 3.10 && { echo "$p"; return 0; }
  done
  return 1
}

# ---- ActivityWatch discovery ----------------------------------------------------
# aw_bin_in_dir <dir> <name>: echo the executable for <name> inside <dir>
# (unpacked bundle: <dir>/<name>/<name>; .app: <dir>/<name> or <dir>/<name>/<name>; for an
# .app/Contents/MacOS dir also ../Frameworks/<name> and ../Resources/<name>)
aw_bin_in_dir() {
  local d="$1" n="$2"
  if [ -f "$d/$n/$n" ] && [ -x "$d/$n/$n" ]; then echo "$d/$n/$n"; return 0; fi
  if [ -f "$d/$n" ] && [ -x "$d/$n" ]; then echo "$d/$n"; return 0; fi
  # ActivityWatch.app: Contents/MacOS holds the Python aw-server and the watchers, but the
  # Rust server lives in Contents/Frameworks (Contents/Resources has a symlink to it)
  case "$d" in
    */Contents/MacOS)
      if [ -f "${d%/MacOS}/Frameworks/$n" ] && [ -x "${d%/MacOS}/Frameworks/$n" ]; then echo "${d%/MacOS}/Frameworks/$n"; return 0; fi
      if [ -f "${d%/MacOS}/Resources/$n" ] && [ -x "${d%/MacOS}/Resources/$n" ]; then echo "${d%/MacOS}/Resources/$n"; return 0; fi ;;
  esac
  return 1
}

# aw_resolve_home: echo the install dir AW_HOME designates, or fail if it holds no server.
# Accepts the install dir, an ActivityWatch.app (or its Contents dir), an aw-server-rust/ dir, or the server binary itself
# (<install>/aw-server-rust/aw-server-rust; resolved via dirname, twice if needed).
aw_resolve_home() {
  local h="${AW_HOME:-}" d n
  [ -n "$h" ] || return 1
  [ "$h" = "/" ] || h="${h%/}"
  if [ -f "$h" ]; then
    set -- "$(dirname "$(dirname "$h")")" "$(dirname "$h")"
  elif [ -d "$h" ]; then
    case "$(basename "$h")" in aw-*) set -- "$h" "$(dirname "$h")" ;; *) set -- "$h" ;; esac
  else
    return 1
  fi
  for d in "$@"; do
    # an .app or its Contents dir designates Contents/MacOS
    case "$d" in
      *.app) d="$d/Contents/MacOS" ;;
      */Contents) d="$d/MacOS" ;;
    esac
    for n in aw-server-rust aw-server; do
      if aw_bin_in_dir "$d" "$n" >/dev/null; then echo "$d"; return 0; fi
    done
  done
  return 1
}

# aw_candidate_dirs: candidate install dirs, in priority order (one per line)
aw_candidate_dirs() {
  local p
  p="$(aw_resolve_home || true)"
  [ -n "$p" ] && printf '%s\n' "$p"
  p="$(command -v aw-server-rust 2>/dev/null || true)"
  [ -n "$p" ] && dirname "$p"
  printf '%s\n' \
    "/Applications/ActivityWatch.app/Contents/MacOS" \
    "$HOME/Applications/ActivityWatch.app/Contents/MacOS" \
    "$HOME/Downloads/activitywatch" \
    "$HOME/activitywatch" \
    "/Applications/activitywatch" \
    "$HOME/Applications/activitywatch"
}

# find_activitywatch_dir: echo the first directory holding aw-server-rust (first match
# wins); if none has it, the first directory holding the Python aw-server. Fails if none.
find_activitywatch_dir() {
  local d name
  for name in aw-server-rust aw-server; do
    while IFS= read -r d; do
      [ -n "$d" ] && [ -d "$d" ] || continue
      if aw_bin_in_dir "$d" "$name" >/dev/null; then echo "$d"; return 0; fi
    done <<EOT
$(aw_candidate_dirs)
EOT
  done
  return 1
}

# aw_find_bin <dir> <name>: binary from <dir>, else from PATH
aw_find_bin() {
  aw_bin_in_dir "$1" "$2" && return 0
  command -v "$2" 2>/dev/null
}

# has_quarantine <path>: success when macOS quarantine xattr is set on path
has_quarantine() {
  [ "$(uname -s)" = "Darwin" ] || return 1
  xattr "$1" 2>/dev/null | grep -q 'com.apple.quarantine'
}

# ---- pid / process management ---------------------------------------------------
# A pid file holds two lines: the pid, then the process start time (ps lstart).
# A recorded pid is only trusted if the live process still looks like what we
# started (command contains the expected token and the start time matches);
# otherwise the pid file is stale and nothing is ever signalled.
pid_file() { echo "$RUN_DIR/$1.pid"; }
# alive = exists and is not a zombie (kill -0 succeeds on defunct processes)
pid_alive() {
  local st
  [ -n "${1:-}" ] || return 1
  kill -0 "$1" 2>/dev/null || return 1
  st="$(ps -p "$1" -o stat= 2>/dev/null || true)"
  case "$st" in *Z*) return 1 ;; esac
  return 0
}
read_pid() { [ -f "$(pid_file "$1")" ] && head -n 1 "$(pid_file "$1")" || true; }
read_pid_start() { [ -f "$(pid_file "$1")" ] && sed -n '2p' "$(pid_file "$1")" || true; }
# start time is read under TZ=UTC so a timezone/DST change cannot make a live service look stale
proc_start() { TZ=UTC ps -p "$1" -o lstart= 2>/dev/null | sed 's/^ *//' || true; }

# pid_is_ours <name> <pid>: alive AND still the process we recorded
pid_is_ours() {
  local name="$1" pid="${2:-}" cmd want cur
  pid_alive "$pid" || return 1
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$name" in
    backend)   case "$cmd" in *uvicorn*) ;; *) return 1 ;; esac ;;
    dashboard) case "$cmd" in *npm*|*vite*) ;; *) return 1 ;; esac ;;
    ollama)    case "$cmd" in *ollama*) ;; *) return 1 ;; esac ;;
    aw-server) case "$cmd" in *aw-watcher*) return 1 ;; esac
               case "$cmd" in */aw-server-rust/aw-server-rust*|*/aw-server/aw-server*|aw-server-rust*|aw-server*|*/aw-server-rust*|*/aw-server|*/aw-server\ *) ;; *) return 1 ;; esac ;;
    aw-watcher-window) case "$cmd" in *aw-watcher-window*) ;; *) return 1 ;; esac ;;
    aw-watcher-afk)    case "$cmd" in *aw-watcher-afk*) ;; *) return 1 ;; esac ;;
    *) return 1 ;;
  esac
  want="$(read_pid_start "$name")"
  if [ -n "$want" ]; then
    cur="$(proc_start "$pid")"
    if [ "$cur" != "$want" ]; then
      # Possibly a pid file written before UTC start times were used (or a reused pid).
      # Never signal it; tell the user so a genuine service is not silently orphaned.
      warn "pid $pid ($name) looks like our process but its start time differs from .run/$name.pid; not treating it as ours. If it is a leftover Lighthouse service, stop it manually: kill $pid"
      return 1
    fi
  fi
  return 0
}

service_running() { pid_is_ours "$1" "$(read_pid "$1")"; }

# kill_tree <pid> <signal>: signal descendants first, then the pid itself
kill_tree() {
  local pid="$1" sig="${2:-TERM}" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

# descendant_pids <pid>: all descendants, one per line
descendant_pids() {
  local c
  for c in $(pgrep -P "$1" 2>/dev/null || true); do
    echo "$c"
    descendant_pids "$c"
  done
}

# stop_service <name>: stop a process we recorded; idempotent
stop_service() {
  local name="$1" pid i=0 snap p
  pid="$(read_pid "$name")"
  if [ -z "$pid" ]; then rm -f "$(pid_file "$name")"; return 0; fi
  if pid_is_ours "$name" "$pid"; then
    snap="$(descendant_pids "$pid")"   # snapshot before TERM: survivors are killed even if the root exits
    kill_tree "$pid" TERM
    while pid_alive "$pid" && [ "$i" -lt 10 ]; do sleep 1; i=$((i + 1)); done
    if pid_alive "$pid"; then
      kill_tree "$pid" KILL
      sleep 1
    fi
    for p in $snap; do
      if pid_alive "$p"; then sleep 1; break; fi
    done
    for p in $snap; do
      if pid_alive "$p"; then kill -KILL "$p" 2>/dev/null || true; fi
    done
    if pid_alive "$pid"; then
      warn "$name (pid $pid) is still running after SIGKILL; leaving $(basename "$(pid_file "$name")") in place"
      return 0
    fi
    if [ "$i" -ge 10 ]; then ok "Stopped $name (pid $pid, killed after ${i}s)"; else ok "Stopped $name (pid $pid)"; fi
  elif pid_alive "$pid" && { sleep 1; pid_alive "$pid"; }; then   # grace: it may be mid-exit
    warn "Ignoring stale .run/$name.pid: pid $pid is now an unrelated process (not signalled)"
  else
    info "$name already stopped (pid $pid)"
  fi
  rm -f "$(pid_file "$name")"
}

stop_all() {
  local n found=0
  for n in dashboard backend aw-watcher-window aw-watcher-afk aw-server ollama; do
    [ -f "$(pid_file "$n")" ] && found=1
    stop_service "$n"
  done
  [ "$found" -eq 1 ] || info "Nothing to stop (no pid files in .run/)"
}

# NS: command prefix that runs a command in a NEW SESSION (no controlling terminal, so
# closing the launching terminal cannot HUP/EIO it). The pid is unchanged (exec), so pid
# files and pid_is_ours keep working. macOS has no setsid(1): use perl, then python3.
# Fallback "env" (no-op) keeps the array non-empty (bash 3.2 + set -u).
if have setsid; then NS=(setsid)
elif have perl; then NS=(perl -e 'use POSIX qw(setsid); setsid() or warn "setsid: $!\n"; exec { $ARGV[0] } @ARGV or die "exec: $!"' --)
elif have python3; then NS=(python3 -c 'import os,sys
try:
    os.setsid()
except OSError:
    pass
os.execvp(sys.argv[1], sys.argv[1:])')
else NS=(env)
fi

# start_bg <name> <workdir> <cmd...>: run detached with log + pid file (pid + start time)
start_bg() {
  local name="$1" dir="$2"; shift 2
  mkdir -p "$LOG_DIR"
  : > "$LOG_DIR/$name.log"
  ( cd "$dir" && exec nohup "${NS[@]}" "$@" </dev/null >>"$LOG_DIR/$name.log" 2>&1 ) &
  local pid=$!
  printf '%s\n%s\n' "$pid" "$(proc_start "$pid")" > "$(pid_file "$name")"
  disown "$pid" 2>/dev/null || true
}

# start_bg_supervised <name> <workdir> <cmd...>: like start_bg, but the command runs under a
# small keeper shell that waits for it and forwards TERM/INT/HUP. The keeper pid (recorded)
# stays alive for the command's lifetime, so commands that exit when their parent changes
# (aw-watcher-afk) survive a detached start.sh.
start_bg_supervised() {
  local name="$1" dir="$2"; shift 2
  mkdir -p "$LOG_DIR"
  : > "$LOG_DIR/$name.log"
  ( cd "$dir" && exec nohup "${NS[@]}" /bin/bash -c '"$@" & child=$!
trap "kill -TERM \$child 2>/dev/null" TERM INT HUP
wait $child
while kill -0 $child 2>/dev/null; do wait $child; done' _ "$@" </dev/null >>"$LOG_DIR/$name.log" 2>&1 ) &
  local pid=$!
  printf '%s\n%s\n' "$pid" "$(proc_start "$pid")" > "$(pid_file "$name")"
  disown "$pid" 2>/dev/null || true
}

# supervised_child_alive <name>: the keeper's wrapped command is still running
supervised_child_alive() {
  local pid c
  pid="$(read_pid "$1")"
  pid_alive "$pid" || return 1
  for c in $(pgrep -P "$pid" 2>/dev/null || true); do
    pid_alive "$c" && return 0
  done
  return 1
}
