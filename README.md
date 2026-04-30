# roth-converter

A web calculator that helps answer: how much should I convert from a
Traditional 401(k) to a Roth 401(k) each year, given a few rate-of-return
assumptions and a horizon?

v1 ships a **sensitivity matrix**, not an optimizer. You pick a handful of
annual conversion amounts and rates of return; the calculator runs each
combination forward year-by-year and shows you the trade-off between tax
paid now and tax-free balance later.

The long-form strategy and the v2 optimizer design live in
`docs/roth-conversion-strategy.md`.

## What it does

Inputs (form):

- Age, filing status, annual other taxable income (held flat across the
  horizon)
- Traditional 401(k) and Roth 401(k) balances (the form computes the total)
- Horizon in years (default 10)
- Comma-separated list of annual rates of return (default 5, 7, 9, 11)
- Comma-separated list of annual conversion amounts to test as separate
  strategies (the $0 baseline is always added)
- Include-RMD toggle (SECURE Act 2.0 ages 73 / 75)
- Tax year for the bracket data (default 2026)

Per-year math (each scenario):

    taxable_income = other_income + conversion + RMD
    federal_tax    = ordinary_tax(max(0, taxable_income - std_deduction), filing_status)
    trad'          = (trad - conversion - RMD) * (1 + rate)
    roth'          = (roth + conversion)       * (1 + rate)

Tax is assumed paid from outside the 401(k), so 100% of the conversion
lands in Roth.

Output (UI):

- Sensitivity matrix grid: rows = annual conversion strategies, columns =
  rates of return. Each cell shows total federal tax, ending total balance,
  and the Traditional / Roth split.
- Click any cell to open a draggable, floating drill-in dialog with:
  - A bracket-fill chart of taxable income across the horizon, with dashed
    federal-bracket reference lines for the chosen filing status.
  - Year-by-year detail table (RMD, conversion, taxable, federal tax,
    ending balances).
- Open multiple dialogs to compare strategies side-by-side; close any one
  with the X button or by clicking the same matrix cell again.

## Quick start

    cp .env.example .env
    ./scripts/start.sh

    # backend on :8090, frontend on :3010
    # tmux session named "roth"; attach with: tmux attach -t roth

Or run the two services manually:

    cd backend  && go build -o bin/roth-server ./cmd/roth-server && ./bin/roth-server
    cd apps/web && npm install && npm run dev

## Layout

    backend/                Go hexagonal service
      cmd/roth-server/      entry point
      internal/
        domain/             types and pure rules
        ports/              TaxTablesRepo, MatrixCalculator
        adapters/
          solver/           greedy cross-product solver (v1)
          taxtables/        JSON-backed tax-table repo
          http/             stdlib http.ServeMux router + handlers
        app/                wiring
        config/, logger/    cross-cutting

    apps/web/               Next.js 16 single-page calculator
      app/page.tsx          form, matrix, dialogs, BracketChart
      lib/api.ts            request/response types and HTTP client

    data/                   tax-tables-{year}.json (federal brackets,
                            standard deduction, IRMAA / NIIT / SS / RMD
                            divisors)

    docs/                   strategy spec and reference

## API

POST /matrix returns one Scenario per (rate, conversion) pair plus the
filing-status brackets and standard deduction the solver used:

    {
      "scenarios": [
        {
          "rate_of_return": 0.07,
          "conversion_amount": 50000,
          "years":   [{ "year_index": 1, "calendar_year": 2026, ... }, ...],
          "summary": { "total_federal_tax": ..., "ending_total": ..., ... }
        },
        ...
      ],
      "brackets": [{ "rate": 0.10, "max": 24800 }, ...],
      "standard_deduction": 32200
    }

The brackets and standard deduction are returned at the response level
because every scenario in a single request shares a filing status and tax
year. The frontend uses them to draw the bracket-fill chart's reference
lines and convert pre-deduction taxable income into post-deduction taxable
income for the Y axis.

## v1 scope

- Greedy per-year projection over the full cross product of (rate,
  conversion) inputs. No optimization across years.
- Federal ordinary brackets and standard deduction by filing status.
- Optional RMD application once the user reaches the SECURE Act 2.0 start
  age. RMD leaves the system (reduces ending balance).
- Conversion is capped each year by the post-RMD Traditional balance.
- 2026 tax tables shipped in `data/tax-tables-2026.json` (TCJA extended
  permanently via OBBBA July 2025).

## v2 deferrals

Documented in `docs/roth-conversion-strategy.md` section 8. The biggest
items:

- Multi-year DP optimizer that picks the conversion amount per year (the
  v2 ConversionSolver port lets us swap implementations without touching
  handlers; that is the payoff of the hexagonal layout).
- IRMAA / ACA / NIIT / Social Security taxability overlays.
- Per-year input overrides (different other_income each year, COLA, etc.).
- State income tax.
- Bracket-target preset chips (fill 12%, fill 24%) and Sankey
  visualizations.
- Monte Carlo sensitivity instead of point-in-time rates.

## Tech stack

- Backend: Go 1.22+, stdlib `http.ServeMux` (Go 1.22 pattern matching),
  zerolog, hexagonal layout (domain / ports / adapters).
- Frontend: Next.js 16, React 19, TypeScript, Tailwind v4, Recharts.
- Storage: stateless. Tax-table JSON loaded at boot, no user data
  persisted.
- Communication: REST only. No SSE, no WebSocket.

## License

Personal use. Not financial advice.
