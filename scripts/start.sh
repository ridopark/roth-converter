#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "[start] .env not found, copying .env.example"
  cp .env.example .env
fi

set -a; source .env; set +a

mkdir -p logs

echo "[start] building backend..."
( cd backend && go build -o bin/roth-server ./cmd/roth-server )

SESSION="roth"
tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -n server "cd $ROOT && ./backend/bin/roth-server 2>&1 | tee logs/server.log"
tmux new-window  -t "$SESSION" -n web    "cd $ROOT/apps/web && npm run dev 2>&1 | tee $ROOT/logs/web.log"

echo "[start] tmux session '$SESSION' running. Attach with: tmux attach -t $SESSION"
echo "  backend: http://localhost:${PORT:-8090}"
echo "  web:     http://localhost:3010"
