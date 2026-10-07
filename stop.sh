#!/usr/bin/env bash
# Stop the processes recorded in .run/*.pid (and their children), after verifying each pid is still ours. Idempotent.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/lib.sh"
case "${1:-}" in
  -h|--help) echo "Usage: ./stop.sh   Stops anything recorded in .run/*.pid (Viveka browser window, Viveka desktop app, dashboard, backend, aw-watcher-window, aw-watcher-afk, aw-server, ollama; watchers are stopped before the server), only if the pid still belongs to that service."; exit 0 ;;
  "") ;;
  *) die "Unknown option: $1" ;;
esac
stop_all
