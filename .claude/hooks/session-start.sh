#!/bin/bash
# Installs CLI tools that project hooks/skills depend on (cloud sessions start from a fresh container).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v graphify >/dev/null 2>&1; then
  pip install -q graphifyy >/dev/null 2>&1 || echo "graphify install failed" >&2
fi
