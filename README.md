# roth-converter

A web calculator that answers: how much should I convert from Traditional IRA
to Roth IRA each year to minimize lifetime taxes?

The full strategy and algorithm are in `docs/roth-conversion-strategy.md`.

## What it does

Given a user profile (filing status, age, retirement timing, balances, income
forecast), the solver produces a year-by-year conversion plan that respects:

- Federal ordinary income brackets (chosen target: top of 12, 22, or 24)
- IRMAA Medicare surcharge tiers (5 cliffs, 2-year lookback)
- ACA premium tax credit cliff (returned in 2026 at 400% FPL)
- Social Security taxation phase-ins
- Net Investment Income Tax threshold
- RMD-first rule once age 73 / 75 (per SECURE Act 2.0)
- State income tax (configurable)
- Available cash to pay conversion tax

Cliffs are hard constraints. The solver picks the largest conversion that
stays below the binding ceiling each year.

## Quick start

  cp .env.example .env
  make build
  make dev

  # backend on :8090, frontend on :3010

## Layout

  backend/     Go hexagonal service (domain, ports, adapters)
  apps/web/    Next.js 16 calculator UI
  data/        Annual tax-table JSON (federal brackets, IRMAA, etc.)
  docs/        Strategy spec and reference

## v1 scope

- Greedy per-year solver with cliff-aware min().
- 2026 federal/IRMAA/ACA/SS/NIIT data shipped in `data/tax-tables-2026.json`.
- State model: pick "none", "flat", or one of a few common states.
- POST /plan returns the full year-by-year plan + summary.

## v2 deferrals

See `docs/roth-conversion-strategy.md` section 8.

## License

Personal use. Not financial advice.
