# roth-converter

A web calculator that helps answer: how much should I convert from a
Traditional 401(k) to a Roth 401(k) each year, given your other income,
Social Security, Medicare-premium tier, ACA-subsidy cliff, investment
income, RMDs, and a horizon?

The app ships in three modes:

- **Sensitivity matrix** — pick a handful of annual conversion amounts and
  rates of return; the calculator runs each combination forward year-by-year
  and shows the trade-off between tax paid now and tax-free balance later.
- **Bracket-fill plan** — a single-rate optimizer that fills the target
  federal bracket each year, capped by what's left in Traditional and
  optionally by the IRMAA standard tier so the 2-year-lookback Medicare
  surcharge stays at $0.
- **Multi-year DP plan** — a backward-induction optimizer that minimizes
  total horizon cost (federal tax + state tax + IRMAA + NIIT + ACA penalty +
  terminal lump-sum tax on remaining Traditional) across all possible
  conversion paths. Wins over greedy when there are cliffs (IRMAA tier
  crossings, pre-RMD low-income years).

Long-form strategy and design notes live in `docs/roth-conversion-strategy.md`.

## What it models

Inputs (form):

- Age, filing status, state (for state income tax)
- Annual other taxable income, annual Social Security benefit
- Investment income: long-term capital gains + qualified dividends (folded
  into MAGI for IRMAA / NIIT / ACA gating)
- Pre-Medicare ACA inputs (age < 65 only): household size and estimated
  annual premium for the cliff penalty
- Traditional 401(k) and Roth 401(k) balances (the form computes the total)
- Horizon in years (default 10)
- Comma-separated rates of return (default 5, 7, 9, 11) — matrix mode only
- Comma-separated conversion amounts to test as separate strategies — matrix
  mode only ($0 baseline always added)
- Single rate-of-return + target federal bracket — plan mode only
- Strategy radio: "Bracket fill (greedy)" or "Multi-year DP" — plan mode
- "Respect IRMAA tier" toggle — caps conversion at the standard tier when
  age >= 63 (the year your MAGI starts seeding a Medicare surcharge)
- "Advanced: edit per-year inputs" toggle — opens a mini-spreadsheet where
  other income, SS benefit, and (plan mode) rate of return can vary per
  horizon year. Defaults to the scalar values.
- Include-RMD toggle (SECURE Act 2.0 ages 73 / 75)
- Tax year for the bracket data (default 2026)

Per-year math (each scenario):

    taxable_ss     = TaxableSS(other + conv + rmd + ltcg, ss_benefit)   # IRC §86 piecewise
    ord_taxable    = other + conv + rmd + taxable_ss
    magi           = ord_taxable + ltcg                                 # LTCG in MAGI but not ordinary
    after_std      = max(0, ord_taxable - std_deduction)
    federal_tax    = ordinary_tax(after_std, filing_status)
    state_tax      = after_std * state_rate
    niit           = niit_rate * min(ltcg, max(0, magi - niit_threshold))
    irmaa          = age >= 65 ? IRMAA(magi_two_years_ago, status, age) : 0
    aca_penalty    = (age < 65 && hh_size > 0 && magi > 4 * fpl(hh_size)) ? premium : 0
    trad'          = (trad - conv - rmd) * (1 + rate)
    roth'          = (roth + conv)       * (1 + rate)

Tax is assumed paid from outside the 401(k), so 100% of the conversion
lands in Roth. LTCG / qualified dividends are tracked in MAGI (so they
gate IRMAA, NIIT, and the ACA cliff) but are *not* added to ordinary
taxable income — the LTCG bracket math is deferred.

Output (UI):

- Sensitivity matrix grid: rows = annual conversion strategies, columns =
  rates of return. Cells break out federal tax, state tax (when state is
  set), IRMAA (when non-zero), NIIT, ACA penalty, taxable SS, and ending
  total / Traditional / Roth balances.
- Click any cell to open a draggable, floating drill-in dialog with:
  - A bracket-fill chart of taxable income across the horizon. Gray dashed
    lines mark federal-bracket tops; **purple dashed lines** mark IRMAA
    tier tops (MAGI threshold minus standard deduction). The tooltip shows
    which IRMAA tier the user is in for years 65+.
  - Year-by-year detail table with conditional columns for Taxable SS,
    IRMAA, NIIT, and ACA penalty when any year has a non-zero value.
- Plan mode (bracket-fill or DP) shows a single deterministic plan with
  the same chart and table.
- Open multiple matrix dialogs to compare strategies side-by-side; close
  any one with X or by clicking the same cell again.

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
        domain/             types and pure rules (TaxTables, ProjectYear,
                            IRMAA, TaxableSS, NIIT, ACA helpers)
        ports/              TaxTablesRepo, MatrixCalculator,
                            ConversionSolver, Notifier
        adapters/
          solver/           matrix solver (cross-product projection)
          optimizer/        bracket_fill (greedy), dp (multi-year DP),
                            router (strategy dispatch)
          taxtables/        JSON-backed tax-table repo
          http/             stdlib http.ServeMux router + handlers
          notifier/         Discord webhook adapter
        app/                wiring
        config/, logger/    cross-cutting

    apps/web/               Next.js 16 single-page calculator
      app/page.tsx          form, matrix, dialogs, BracketChart, PlanView,
                            PerYearAdvanced, MatrixCellRow, YearTable
      lib/api.ts            request/response types and HTTP client

    data/                   tax-tables-{year}.json (federal brackets,
                            standard deduction, IRMAA tiers, SS thresholds,
                            NIIT threshold + rate, ACA 400% FPL,
                            RMD divisors, state top-marginal rates)

    docs/                   strategy spec and reference

## API

All requests are JSON over REST. New fields are additive (`omitempty` on
the wire), so v1 callers see identical responses for v1 inputs.

### POST /matrix

Body fields (omitting any defaults to the scalar / no-op behavior):

    {
      "age": 65, "birth_year": 1961, "filing_status": "mfj",
      "total_401k": 1000000, "traditional_pct": 0.7, "roth_pct": 0.3,
      "annual_other_income": 50000, "annual_ss_benefit": 0,
      "taxable_div_ltcg": 0,
      "aca_household_size": 0, "aca_annual_premium": 0,
      "magi_two_years_ago": 0, "magi_one_year_ago": 0,
      "horizon_years": 10, "include_rmd": true, "tax_year": 2026,
      "state": "",
      "rates_of_return": [0.05, 0.07, 0.09, 0.11],
      "conversion_cases": [0, 25000, 50000, 100000, 200000],
      "other_income_per_year": [...],     // optional per-year overrides
      "ss_benefit_per_year": [...],
      "taxable_div_ltcg_per_year": [...]
    }

Returns one Scenario per (rate, conversion) pair, plus the filing-status
brackets, IRMAA tiers, standard deduction, and state rate the solver used:

    {
      "scenarios": [
        {
          "rate_of_return": 0.07,
          "conversion_amount": 50000,
          "years": [
            {
              "year_index": 1, "calendar_year": 2026, "age": 65,
              "rmd": 0, "conversion": 50000,
              "taxable_income": 67800, "magi": 67800,
              "federal_tax": ..., "state_tax": ...,
              "taxable_ss": 0, "irmaa_surcharge": 0, "irmaa_tier_label": "standard",
              "niit": 0, "aca_penalty": 0,
              "ending_traditional": ..., "ending_roth": ..., "ending_total": ...
            }, ...
          ],
          "summary": {
            "total_federal_tax": ..., "total_state_tax": ...,
            "total_irmaa_surcharge": 0, "total_taxable_ss": 0,
            "total_niit": 0, "total_aca_penalty": 0,
            "total_converted": ..., "ending_total": ...
          }
        }, ...
      ],
      "brackets": [{ "rate": 0.10, "max": 24800 }, ...],
      "standard_deduction": 32200,
      "state_tax_rate": 0,
      "irmaa_tiers": [{ "label": "standard", "max_magi": 218000, ... }, ...]
    }

### POST /optimize

Same Profile inputs as /matrix, plus the optimizer-specific fields:

    {
      ...,                                 // same Profile fields
      "rate_of_return": 0.07,
      "target_bracket_rate": 0.22,
      "respect_irmaa": true,               // optional, default true
      "strategy": "dp",                    // "bracket_fill" or "dp", default bracket_fill
      "rates_per_year": [0.05, 0.07, ...]  // optional per-year override
    }

Returns one OptimizePlan with the same Scenario shape plus the strategy
and IRMAA tier reference data the chart needs:

    {
      "plan": { "rate_of_return": 0.07, "years": [...], "summary": {...} },
      "brackets": [...], "standard_deduction": 32200, "state_tax_rate": 0,
      "target_bracket_rate": 0.22, "target_bracket_top": 100800,
      "irmaa_tiers": [...],
      "respect_irmaa": true,
      "strategy": "bracket_fill"
    }

The strategy router behind `ports.ConversionSolver` dispatches `"dp"` to
`internal/adapters/optimizer/dp.go` and anything else to `bracket_fill.go`.
A 10-year / $1M DP solve takes ~500ms.

### GET /brackets?status=mfj&year=2026

Returns the federal ordinary brackets and standard deduction for the
filing status. Used by the form's "Add bracket-fill" preset chips.

### GET /states?year=2026

Returns the no-tax state list and approximate top-marginal rates by code.

## Capabilities

Now in scope:

- Greedy per-year matrix projection over the full cross product of (rate,
  conversion) inputs.
- Greedy bracket-fill optimizer with optional IRMAA-tier cap.
- Multi-year DP optimizer over (year, trad-balance bucket, MAGI lookback
  tier) state — backward induction with two-stage memoization, terminal
  lump-sum cost on remaining Traditional balance.
- Federal ordinary brackets, state top-marginal income tax, RMDs (SECURE
  Act 2.0 73/75), Social Security taxability (IRC §86 piecewise), IRMAA
  tiers with 2-year MAGI lookback, NIIT, ACA 400%-FPL cliff penalty.
- Per-year input overrides for other income, SS benefit, LTCG/dividends,
  and rate of return — defaults fall back to the scalar fields when the
  array is shorter than the horizon.
- IRMAA tier visualization: purple dashed reference lines on the bracket
  chart, plus a tooltip indicating which tier each year falls into.
- 2026 tax tables shipped in `data/tax-tables-2026.json` (TCJA extended
  permanently via OBBBA July 2025; CMS 2026 Medicare premium notice; ACA
  2026 FPL with the cliff returning post-2025 enhanced-subsidy expiry).

Not yet modeled (deferred):

- LTCG bracket tax. LTCG / qualified dividends are tracked in MAGI (gating
  IRMAA / NIIT / ACA) but ordinary tax does not include them. For users
  with material taxable-account dividend or capital gains income, the
  displayed federal-tax total understates reality until LTCG bracket math
  ships.
- Per-state full bracket schedules (currently a flat top-marginal rate per
  state).
- Sankey visualization of money flow across the horizon.
- Monte Carlo sequence-of-returns sensitivity (today: point rates).
- Save/load named scenarios (would require persistence + auth).

## Deployment

Live: https://roth-converter.ridopark.com (frontend, Cloudflare Pages),
https://roth-converter-api.ridopark.com (backend, Caddy + OCI VM).

The backend runs as a systemd service on the same Oracle Cloud free-tier
ARM64 VM that hosts other ridopark.com tools, fronted by Caddy with auto
Let's Encrypt. The frontend is a Next.js static export deployed to
Cloudflare Pages.

### Production port

Local dev binds the backend to 8090; the prod systemd unit binds to 8092
because 8090 is already taken on the shared OCI VM. Caddy routes the
public hostname to the local port.

### One-time setup

OCI VM:

- Append the host block in `deployments/Caddyfile.snippet` to
  `/etc/caddy/Caddyfile` and `sudo systemctl reload caddy`.

Cloudflare:

- Pages project named `roth-converter` (Direct Upload).
- DNS: `roth-converter` CNAME to `roth-converter.pages.dev` (proxied) and
  `roth-converter-api` A to the OCI public IP (proxied).
- API token with `Account:Cloudflare Pages:Edit` scope.

GitHub Actions secrets (`gh secret set <NAME>`):

| Secret                    | Value                                                  |
|---------------------------|--------------------------------------------------------|
| `OCI_HOST`                | OCI VM public IP                                       |
| `OCI_USER`                | `ubuntu`                                               |
| `OCI_SSH_KEY`             | private SSH key (PEM)                                  |
| `CLOUDFLARE_API_TOKEN`    | Cloudflare Pages API token                             |
| `CLOUDFLARE_ACCOUNT_ID`   | Cloudflare account ID                                  |
| `NEXT_PUBLIC_BACKEND_URL` | `https://roth-converter-api.ridopark.com`              |
| `CORS_ALLOW_ORIGIN`       | `https://roth-converter.ridopark.com`                  |
| `DISCORD_WEBHOOK_URL`     | Discord webhook for notifications                      |

### CI/CD flow

Push to `main` triggers `.github/workflows/ci.yml`:

1. `test`: `go test -race ./...` plus a verify-only ARM64 build.
2. `frontend-build`: `STATIC_EXPORT=1 npm run build` writes `apps/web/out/`.
3. `deploy-frontend`: `wrangler pages deploy out/ --project-name=roth-converter`.
4. `deploy-backend`: cross-compile ARM64 Go binary, scp to
   `/opt/roth-converter/`, write `.env`, install systemd unit, restart,
   smoke-test `/health`.

### Container parity (local)

`deployments/Dockerfile` and `deployments/Dockerfile.web` build distroless
backend and standalone Next.js images. `deployments/docker-compose.yml`
brings both up locally for parity testing.

## Tech stack

- Backend: Go 1.22+, stdlib `http.ServeMux` (Go 1.22 pattern matching),
  zerolog, hexagonal layout (domain / ports / adapters).
- Frontend: Next.js 16, React 19, TypeScript, Tailwind v4, Recharts.
- Storage: stateless. Tax-table JSON loaded at boot, no user data
  persisted.
- Communication: REST only. No SSE, no WebSocket.

## License

Personal use. Not financial advice.
