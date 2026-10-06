#!/usr/bin/env bash
# Run all test suites and print a pass/fail table.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/lib.sh"

BUILD=0
for a in "$@"; do
  case "$a" in
    --build) BUILD=1 ;;
    -h|--help) echo "Usage: ./test.sh [--build]   Runs extension, dashboard and backend tests (plus a Swift type-check of the desktop buddy on macOS); --build also runs both npm builds after the tests. Requires ./setup.sh first (backend test deps are installed automatically). With --build, if LLM_MODEL is set it is built into the extension as VITE_LLM_MODEL (same as setup.sh); otherwise the extension default/.env applies."; exit 0 ;;
    *) die "Unknown option: $a" ;;
  esac
done

ROWS=""; FAILED=0
record() { # record <label> <status>
  ROWS="$ROWS
$(printf '  %-22s %s' "$1" "$2")"
  case "$2" in *FAIL*|*SKIP*) FAILED=1 ;; esac
}
run() { # run <label> <dir> <cmd...>
  local label="$1" dir="$2"; shift 2
  info "$label"
  if (cd "$dir" && "$@"); then record "$label" "${C_GREEN}PASS${C_RESET}"
  else record "$label" "${C_RED}FAIL${C_RESET}"; fi
}

[ -d "$EXT_DIR/node_modules" ] && [ -d "$DASH_DIR/node_modules" ] && [ -x "$VENV_DIR/bin/python" ] \
  || die "Dependencies missing. Run ./setup.sh --dev first."

run "extension tests" "$EXT_DIR" sh -c 'npm run typecheck && npm test'
run "dashboard tests" "$DASH_DIR" sh -c 'npm run typecheck && npm test'

if [ ! -x "$VENV_DIR/bin/pytest" ]; then
  info "pytest missing; installing requirements-dev.txt"
  if UVBIN="$(find_uv)"; then "$UVBIN" pip install -q -r "$BACKEND_DIR/requirements-dev.txt" --python "$VENV_DIR/bin/python"
  else "$VENV_DIR/bin/python" -m pip install -q -r "$BACKEND_DIR/requirements-dev.txt"; fi
fi
run "backend tests" "$BACKEND_DIR" .venv/bin/pytest -q

# Sheru's desktop app: type-check the Swift source (no rebuild, so macOS permissions are kept)
if [ "$(uname -s)" = "Darwin" ] && have swiftc; then
  run "buddy (swift)" "$BUDDY_DIR" swiftc -typecheck -swift-version 5 -target "$(uname -m)-apple-macos13.0" macos/main.swift
fi

if [ "$BUILD" -eq 1 ]; then
  if [ -n "${LLM_MODEL:-}" ]; then
    run "extension build" "$EXT_DIR" env VITE_LLM_MODEL="$LLM_MODEL" npm run build
  else
    run "extension build" "$EXT_DIR" npm run build
  fi
  run "dashboard build" "$DASH_DIR" npm run build
fi

printf '\n%sResults%s%s\n\n' "$C_BOLD" "$C_RESET" "$ROWS"
if [ "$FAILED" -eq 0 ]; then ok "All suites passed"; else err "Some suites failed"; exit 1; fi
