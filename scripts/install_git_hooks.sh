#!/usr/bin/env bash

set -euo pipefail

STATUS_ONLY=false
if [[ "${1:-}" == "--status" ]]; then
  STATUS_ONLY=true
fi

if ! command -v git >/dev/null 2>&1; then
  if [[ "$STATUS_ONLY" == true ]]; then
    echo "git not available"
  else
    echo "[hooks] Skipping install: git is not available."
  fi
  exit 0
fi

if [[ ! -d .git ]]; then
  if [[ "$STATUS_ONLY" == true ]]; then
    echo "not a git worktree"
  else
    echo "[hooks] Skipping install: .git directory not found."
  fi
  exit 0
fi

if [[ "$STATUS_ONLY" == true ]]; then
  git config --get core.hooksPath || echo "(default .git/hooks)"
  exit 0
fi

git config --local core.hooksPath .githooks
echo "[hooks] Installed hooks path: .githooks"
