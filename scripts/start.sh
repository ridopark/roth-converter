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
# Pass .env-sourced vars explicitly into the tmux pane: the tmux server's
# stored environment can shadow our shell (e.g. a stale PORT from another
# project), so inline-prefixing the binary call wins.
BACKEND_ENV="PORT=${PORT} LOG_LEVEL=${LOG_LEVEL} FRONTEND_URL=${FRONTEND_URL} CORS_ALLOW_ORIGIN=${CORS_ALLOW_ORIGIN} TAX_TABLES_DIR=${TAX_TABLES_DIR} DEFAULT_TAX_YEAR=${DEFAULT_TAX_YEAR}"
tmux new-session -d -s "$SESSION" -n server "cd $ROOT && env ${BACKEND_ENV} ./backend/bin/roth-server 2>&1 | tee logs/server.log"
tmux new-window  -t "$SESSION" -n web    "cd $ROOT/apps/web && npm run dev 2>&1 | tee $ROOT/logs/web.log"

echo "[start] tmux session '$SESSION' running. Attach with: tmux attach -t $SESSION"
echo "  backend: http://localhost:${PORT:-8090}"
echo "  web:     http://localhost:3010"
