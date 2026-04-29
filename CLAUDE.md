## Rules
- Read before writing. Don't re-read unchanged files.
- Edit, don't rewrite. Minimal diffs.
- No sycophantic openers ("Sure!", "Great question!") or closing fluff.
- No restating the question. No unsolicited suggestions.
- ASCII only: no em dashes, smart quotes, or Unicode decoration.
- Plain text over tables/headers unless structure aids clarity.
- No comments in code unless the WHY is non-obvious.
- No speculative abstractions, error handling for impossible cases, or backwards-compat shims.
- Parallelize independent tool calls in one message.
- User instructions override this file.

## Architecture
- Go backend: hexagonal (domain -> ports -> adapters). Solves the multi-year Roth-conversion optimization problem given a user profile, balances, and income forecast.
- Next.js 16 frontend: single-page calculator. Form -> POST /matrix -> sensitivity grid + year-by-year tables.
- Communication: REST only. No SSE, no WebSocket.
- Storage: stateless v1. Tax-table JSON (data/tax-tables-{year}.json) is loaded at boot. No user data persisted.
- Hexagonal payoff: ConversionSolver port lets us swap greedy v1 for a multi-year DP solver in v2 without changing handlers.

## Domain spec
- Strategy doc: docs/roth-conversion-strategy.md (the long-form reference; the optimizer described in section 5 is a v2 goal).
- v1 calculator is a SENSITIVITY MATRIX, not an optimizer. The user fixes the variables (rate of return, annual conversion amount) and the calculator shows the resulting (federal tax paid, 401k traditional balance, 401k Roth balance) over the horizon.
- Inputs: age, total 401k, traditional/Roth split, filing status, annual other taxable income, list of rates of return, list of annual conversion amounts, horizon (default 10), include_rmd flag.
- Output: one Scenario per (rate, conversion) pair, each with year-by-year detail and a summary (total federal tax, ending traditional, ending Roth, ending total).
- Per-year math: taxable_income = other_income + conversion + RMD; federal_tax = ordinary_tax(max(0, taxable_income - std_deduction), filing_status); trad' = (trad - conv - rmd) * (1+r); roth' = (roth + conv) * (1+r). Tax is assumed paid from outside the 401k (so 100% of the conversion lands in Roth).
- 2026 reference data is the default (TCJA extended permanently via OBBBA July 2025). Update tax-tables-{year}.json each November when IRS Rev. Proc. drops.

## Ports
- Backend: 8090
- Frontend: 3010

## Build & Run
- Backend: `cd backend && go build -o bin/roth-server ./cmd/roth-server`
- Frontend: `cd apps/web && npm run dev`
- Tests: `cd backend && go test ./...`
- Full cycle: `./scripts/start.sh`

## Module paths
- Go: `github.com/ridopark/roth-converter/backend`

## Conventions
- Error wrap: `fmt.Errorf("component: action: %w", err)`
- Logger: zerolog, `.With().Str("component", name).Logger()`
- Tests: table-driven, `t.Run()` + `stretchr/testify`
- HTTP: stdlib `http.ServeMux` (Go 1.22+ pattern matching). No chi.
