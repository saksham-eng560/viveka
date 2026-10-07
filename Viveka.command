#!/bin/bash
# Double-click this file in Finder to start Viveka (Leo on your desktop, the dashboard and the browser).
# Close the Terminal window or press Ctrl+C to stop everything.
cd "$(dirname "$0")" || exit 1
exec ./start.sh "$@"
