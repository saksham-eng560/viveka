#!/usr/bin/env bash
# Install Sheru's natural voice: kokoro-onnx in the backend venv + verified model files in .models/ (~205 MB, once).
# Run by ./setup.sh, and in the background by ./start.sh when the voice is missing. Safe to re-run.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
if voice_installed; then ok "Sheru's natural voice is already installed"; exit 0; fi
install_voice
