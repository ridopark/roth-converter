---
name: rebuild-commit-restart
description: Rebuild the backend, commit changes, and restart all services. Use when the user asks to deploy local changes, rebuild and restart, or ship what's been working on. Triggers on phrases like 'rebuild', 'restart', 'ship it', 'deploy local', 'rebuild and commit', 'RCR'.
---

# Rebuild, Commit & Restart

Full cycle: rebuild backend, commit changes, shutdown and restart services.

## Workflow

Execute these steps **in order**. Stop on any failure.

### Step 1: Rebuild backend

```bash
cd backend && go build -o bin/roth-server ./cmd/roth-server
```

Verify the build succeeds (exit code 0) before proceeding. If the build fails, **stop here** — do not commit broken code.

### Step 2: Commit changes

**Load and follow the `git-commit-helper` skill for this step.** It defines the commit message format, conventions, and workflow. Defer entirely to that skill for staging, message authoring, and committing.

### Step 3: Restart services

```bash
tmux kill-session -t roth 2>/dev/null || true
./scripts/start.sh > /tmp/roth-start.log 2>&1 && cat /tmp/roth-start.log
```

This rebuilds the binary, kills the previous tmux session, and starts the backend + frontend windows in a fresh `roth` tmux session.

### Step 4: Verify services are running

```bash
tmux has-session -t roth 2>/dev/null && echo "roth: running" || echo "roth: NOT running"
curl -s http://localhost:8090/health || echo "backend: NOT responding"
curl -sI http://localhost:3010/ | head -1 || echo "frontend: NOT responding"
```

Both halves must respond. If either failed, check logs:

```bash
tail -20 logs/server.log logs/web.log
```

## Quick Reference

| Step | Command | Abort on failure? |
|------|---------|-------------------|
| Build | `cd backend && go build -o bin/roth-server ./cmd/roth-server` | **Yes** |
| Commit | *(per git-commit-helper skill)* | **Yes** |
| Restart | `./scripts/start.sh` | **Yes** |
| Verify health | `curl -s http://localhost:8090/health` | Report status |

## Important Notes

- All commands run from the project root: `/home/ridopark/src/roth-converter`
- Logs are written to `logs/server.log` (backend) and `logs/web.log` (frontend)
- Ports: backend 8090, frontend 3010
