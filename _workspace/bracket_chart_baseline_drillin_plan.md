# Calculator UI: bracket-fill chart, pinned baseline row, cell-click drill-in

## Context

The v1 calculator at `apps/web/app/page.tsx` renders a sensitivity matrix
(rows = annual conversion cases, columns = rates of return) plus a per-rate
year-by-year drill-in selected via a tab bar. Backend `POST /matrix` already
returns each scenario's full per-year detail.

Research of 2025 retirement-tax tools (Holistiplan, Boldin, Pralana,
RightCapital, Income Lab, Engaging Data) consistently shows three patterns
the v1 UI is missing:

1. A bracket-fill chart over years is the headline visualization, not a
   tabular grid.
2. The "do nothing" (conversion = 0) baseline is always pinned as a row so
   every other cell reads as a delta.
3. Drill-in happens by clicking a cell, not by switching tabs.

This plan adds those three behaviors. The chart library is Recharts (most
popular React chart lib that fits the existing Tailwind + Next 16 stack).
No backend changes are required — all per-year math is already present in
the response payload.

Out of scope (deferred per `docs/roth-conversion-strategy.md` v2): IRMAA,
ACA, NIIT, SS-taxation overlays; Monte Carlo; scenario save / journal;
Sankey visualizations; bracket-target preset chips ("fill 12%", etc.) —
these belong to a separate input-affordance plan.

## Phases

### Phase A: Pin baseline row (conversion = 0)

Always include 0 as the first conversion case in the request so every
matrix row reads as a delta from "convert nothing." Frontend-side fix.

Files:
- `apps/web/app/page.tsx`
- `apps/web/lib/api.ts` (only if a helper makes sense)

Behavior:
- Before submit, prepend 0 to the parsed conversion-case list if the user
  did not already include it.
- Sort the list ascending so 0 always renders first.
- Do not duplicate 0 if the user typed it.
- The form input string itself stays unchanged; only the request payload
  is normalized.

### Phase B: Cell-click drill-in

Replace the rate-tab bar with click-a-cell-to-expand-below. The drill-in
table only renders when a cell is selected; clicking the same cell again
collapses it; clicking another cell switches.

Files:
- `apps/web/app/page.tsx`

Behavior:
- Each matrix cell is clickable (button-like with hover + focus styles).
- Selected cell has a clear visual highlight (e.g., amber ring matching
  the existing button color).
- Below the matrix: header reads "Year-by-year for $X/yr conversion at Y%
  rate"; a single year-by-year table for the selected (rate, conversion)
  pair, not the per-rate stack of all cases.
- The previous rate-tab UI is removed; the per-rate stacked tables go away.

Keyboard accessibility:
- Cells are reachable by Tab and activated by Enter/Space.

### Phase C: Bracket-fill chart

A new visualization above the matrix that shows taxable income per year
with horizontal reference lines at each federal-bracket top for the user's
filing status. Two series overlaid: the conversion = 0 baseline and the
currently-selected scenario from Phase B.

Files:
- `apps/web/package.json` (add `recharts` dependency)
- `apps/web/app/page.tsx` (new `BracketChart` component)
- `apps/web/lib/api.ts` (export tax-table data shape if needed; otherwise
  the chart receives the bracket list as a prop)

Backend:
- Brackets are not currently returned in the response. Two options:
  (a) hardcode the 2026 MFJ/Single/HoH bracket tops in the frontend
      (small risk of drift; matches the constraint that v1 always uses
      the same year of brackets across the horizon).
  (b) add a `Brackets` field to `MatrixResponse` so the chart receives
      the same brackets the solver used.
- Pick (b). Keeps the chart honest if the user changes `tax_year` and
  the backend loads a different table. Add a `Brackets []domain.Bracket`
  field to `MatrixResponse` populated per scenario or once at the
  response level (response level is enough — all scenarios share a
  filing status and tax year).

Behavior:
- X-axis: calendar year over the horizon.
- Y-axis: dollars.
- Two solid lines: baseline taxable income (gray) and selected-scenario
  taxable income (amber).
- Horizontal dashed reference lines at each bracket top, labeled with
  the rate ("12%", "22%", etc.), drawn behind the income lines.
- Standard deduction is applied: the chart shows post-deduction taxable
  income (`taxable_income - std_deduction`, floored at 0), since the
  bracket boundaries are post-deduction.
- Tooltip on hover shows year, both scenarios' taxable income, and which
  bracket the selected scenario falls in.
- If no cell is selected, the chart still renders with the baseline line
  alone.

## Halt conditions

- Existing Go solver tests fail (`go test ./...` non-zero exit) at any
  point during the run.
- `next dev` fails to compile after a change.
- Three consecutive failed iterations on the same phase, each iteration
  applying a distinct hypothesis.
- A scope item not listed above is required to make a phase pass — stop
  and route through the failure path; do not silently expand.

## Success criteria

Each criterion is verified by collecting the specific evidence named.

1. **Build and tests stay green.**
   Evidence: `go test ./...` exits 0 (solver suite still passes); the
   web app compiles in `next dev` with zero errors (visible in
   `logs/web.log`).

2. **Phase A: baseline row pinned.**
   Evidence (browser): submit the form with `conversion_cases_str` set
   to `"50000, 100000"` (no 0). The matrix renders three rows: `$0/yr`,
   `$50,000/yr`, `$100,000/yr`, in that order. Submit again with
   `"0, 50000"` — only two rows, `$0/yr` and `$50,000/yr`, with no
   duplicate.

3. **Phase B: cell click switches drill-in.**
   Evidence (browser): with the matrix rendered, no drill-in is visible
   initially. Click the cell at row `$50,000/yr`, column `15%`. A single
   year-by-year table appears below the matrix titled with that rate +
   conversion. The clicked cell is visually highlighted. Click a
   different cell — the table updates and the highlight moves. Click the
   same cell — the table collapses (or the highlight clears, per the
   chosen toggle behavior; pick one and apply consistently).
   The previous rate-tab bar is gone.

4. **Phase C: bracket chart renders correctly.**
   Evidence (browser): with no cell selected, a chart appears above the
   matrix showing one solid gray line (baseline taxable income per year)
   and N horizontal dashed reference lines (one per bracket top) labeled
   with the rate. The number of bracket lines equals the number of
   non-37% bracket tops for MFJ (six dashed lines for 10/12/22/24/32/35%
   tops, with the 37% range running off the top of the chart).
   Hovering shows a tooltip with the year + baseline taxable.
   Click a matrix cell with conversion = $100,000 / rate = 15% — a
   second amber line appears. The amber line's year-1 value should
   equal `(other_income + 100000) - standard_deduction_mfj` (with
   `other_income` and the deduction taken from the form / 2026 tables).
   Verify against the same year's value in the year-by-year table to
   the pixel-rounding tolerance of the chart.

5. **No backend regressions.**
   Evidence: `POST /matrix` with the same payload as before returns the
   same `scenarios` array. The new `Brackets` field is additive.

## Sub-agents and tools

- Phase A and B: route to `senior-frontend` skill for the consult, then
  apply edits directly (small UI surface; no need for the full
  TDD-red/green/refactor chain on cosmetic state changes).
- Phase C: route to `senior-frontend` for the chart-component design
  consult, then `tdd-red` -> `tdd-green` if a frontend test framework
  exists in the repo (currently none — skip the TDD chain and rely on
  manual browser verification).
- Backend `Brackets` field on `MatrixResponse`: route to `go-architect`
  for the consult, `tdd-red` -> `tdd-green` -> `tdd-refactor` for the
  implementation, since the existing solver tests should grow a new
  case verifying the field is populated.
- Validation: dispatch `qa-inspector` after Phase C to verify the
  frontend-backend contract (the new `Brackets` field).

## Notes for the executor

- Recharts adds ~50 KB gzipped; acceptable for a tool whose entire UI
  is one page. No code-splitting required.
- The bracket-fill chart pattern is the headline of Holistiplan and the
  closest free analog is Engaging Data's mekko at
  https://engaging-data.com/tax-brackets/ — useful reference for visual
  treatment, not for implementation.
- Backend response shape change is additive; frontend type definitions
  in `apps/web/lib/api.ts` need the new field added.
