# Traditional IRA to Roth IRA Conversion: Strategy and Optimization Spec

This document is the reference and design spec for the roth-converter web app.
The app's job is to answer one question for a user:

  "How much should I convert from Traditional to Roth this year, and in
   future years, to minimize lifetime taxes?"

The first half is the rules and reference data. The second half is the
optimization framework the calculator implements. Last is the inputs/outputs
contract for the website.

All dollar amounts are tax year 2026 unless noted. Verify against IRS
Rev. Proc. 2025-32 and CMS notices each year.

---

## 1. Why this is non-trivial

Converting feels like a single decision ("convert X dollars"), but the dollar
that gets converted passes through a stack of tax surfaces, several of which
are cliffs (one dollar over = thousands of dollars of cost). The optimal
conversion amount is the largest amount that still lands below the next cliff,
across all of these surfaces simultaneously, repeated for each year between
now and the end of life expectancy.

The tax surfaces, in roughly the order they bite:

  1. Federal ordinary-income brackets (a step function, 7 steps)
  2. State income tax (varies)
  3. Long-term capital gains 0% rate (lost at a threshold)
  4. Social Security taxation (50% then 85% taxable, two cliffs)
  5. ACA premium tax credits (cliff at 400% FPL starting 2026)
  6. IRMAA Medicare surcharges (5 cliffs, 2-year lookback)
  7. Net Investment Income Tax (3.8%, MAGI threshold)
  8. RMD interaction once age 73/75 hits
  9. Survivor "widow's penalty" once filing changes from MFJ to single
  10. Future federal-rate uncertainty (currently TCJA-era rates, extended
      via OBBBA July 2025, but Congress can change again)

The right conversion amount is the one that fills the cheapest tax bracket up
to the next cliff and stops, every year, until the Traditional balance is
either depleted or the marginal benefit goes negative.

---

## 2. Mechanics of a conversion

These are the rules that constrain WHEN and HOW conversions happen. They are
constraints, not choices.

### 2.1 Deadline

A conversion must be completed by Dec 31 of the calendar year to count for
that tax year. Unlike contributions, there is no April grace period.

### 2.2 Methods

  - Direct trustee-to-trustee: cleanest. Custodian moves the dollars from
    Traditional to Roth in-kind or as cash. No 60-day risk.
  - Indirect (60-day rollover): user receives a check. Must be redeposited
    in 60 days or it is treated as a distribution (taxed plus 10% if under
    59.5). Limit one indirect rollover per 12-month period across all IRAs.
    Avoid this method.

### 2.3 Irrevocability (no recharacterization)

Since 2018, conversions cannot be undone. If you convert $100k in January
and the market drops 30% in March, you still owe income tax on the
$100k January value.

Implication: spread conversions across the year, or wait for a market dip
to convert. The "convert in Jan" vs "convert in Dec" decision is a separate
optimization (volatility timing).

### 2.4 Pro-rata rule (aggregate IRA rule)

The IRS treats all of your Traditional, SEP, and SIMPLE IRAs as one pool
for the purpose of computing the taxable portion of a conversion. You cannot
"choose" to convert only the after-tax basis.

Formula for taxable portion of a conversion:

  taxable_portion = conversion_amount * (1 - basis / total_pretax_balance)

  where:
    basis             = sum of after-tax (non-deductible) contributions
                        across all Traditional/SEP/SIMPLE IRAs
    total_pretax_balance = sum of YE balance across all those IRAs PLUS the
                        distribution amount itself (per Form 8606)

Employer plans (401k, 403b, 457, TSP) are excluded from this aggregation.
This is why the "mega backdoor Roth" works: 401k after-tax money never
mixes with the IRA pool.

If you have a Traditional IRA with basis and you want clean conversions,
options:
  - Roll pretax dollars from the IRA into a 401k (if the plan accepts
    rollovers in), leaving only basis in the IRA. Then convert the basis
    tax-free.
  - Otherwise accept proportional taxation.

### 2.5 Withholding trap

When the custodian asks "withhold for taxes?" the default answer is NO if
you are under 59.5. Withheld dollars are treated as a distribution, which
means:
  - They do not make it into the Roth (lost tax-free growth forever).
  - If you are under 59.5, the withheld amount is hit with the 10% early-
    withdrawal penalty on top of income tax.

Pay the conversion tax from a taxable brokerage or checking account so 100%
of the conversion lands in the Roth. This is the single largest "free
optimization" in conversions.

### 2.6 Estimated taxes

A large conversion is ordinary income. To avoid the IRS underpayment
penalty, either:
  - Pay quarterly estimated taxes using Form 1040-ES, or
  - Use the safe harbor: pay 100% of last year's tax (110% if AGI was
    over $150k), or
  - Convert late in the year and use a "withholding catch-up" via a W-2
    or 1099-R withholding (since W-4/withholding is treated as paid evenly
    across the year regardless of when it actually happened, this can cure
    underpayment cleanly).

### 2.7 Two 5-year clocks

These are constantly confused. They are independent.

Clock A: account-age clock for earnings.
  - Starts Jan 1 of the year of your FIRST contribution or conversion to
    ANY Roth IRA.
  - Set once. A new contribution does not restart it.
  - Earnings (not principal) are tax-free only after this clock has run
    AND you are 59.5+.

Clock B: per-conversion clock for principal.
  - Each conversion has its own 5-year clock.
  - Withdrawing converted principal before its clock matures triggers a
    10% penalty (the income tax is already paid).
  - Once you are 59.5+, Clock B effectively stops mattering.

Practical: open ANY Roth (even with $1) as early as possible to start
Clock A. Clock B is mostly an early-retiree concern (the conversion ladder).

### 2.8 RMD-first rule

If you are at RMD age (73 for those born 1951-1959, 75 for those born 1960+,
per SECURE Act 2.0), you must take your Required Minimum Distribution
BEFORE you are allowed to convert any other dollars. The RMD itself cannot
be converted.

Implication: the most valuable years for conversions are the gap between
retirement and RMD age. Once RMDs start, the RMD itself fills part of your
low brackets, leaving less room for cheap conversions.

### 2.9 Inherited IRAs

A non-spouse inherited Traditional IRA cannot be converted to a Roth. The
beneficiary is stuck with the Traditional and the 10-year drawdown rule.
This means inherited IRAs are not a target for the calculator.

A spouse who inherits CAN treat the IRA as their own and convert it.

### 2.10 Reporting (Form 8606)

Every year there is conversion activity (or nondeductible contributions, or
basis tracking) you file Form 8606 with your 1040. This form tracks basis
so you do not double-pay tax on after-tax dollars. Missing 8606s in prior
years are the most common source of overpaid tax in real life. The
calculator should remind users to file 8606.

---

## 3. 2026 reference data

Federal numbers for tax year 2026. Recomputed annually.

### 3.1 Standard deduction

  Single        $16,100
  MFJ           $32,200
  HoH           $24,150

Ages 65+ get an additional standard deduction (~$1,650 single, ~$1,300
each MFJ for 2026; verify final IRS numbers). The OBBBA also added a
temporary "senior bonus" deduction for tax years 2025-2028; treat this as
a calculator input that can be turned on/off.

### 3.2 Federal ordinary income brackets

Rates: 10, 12, 22, 24, 32, 35, 37 (extended permanently via OBBBA, July 2025).

Single:
  10%   $0          - $12,400
  12%   $12,401     - $50,400
  22%   $50,401     - $105,700
  24%   $105,701    - $201,775
  32%   $201,776    - $256,225
  35%   $256,226    - $640,600
  37%   $640,601+

Married Filing Jointly:
  10%   $0          - $24,800
  12%   $24,801     - $100,800
  22%   $100,801    - $211,400
  24%   $211,401    - $403,550
  32%   $403,551    - $512,450
  35%   $512,451    - $768,700
  37%   $768,701+

Head of Household:
  10%   $0          - $17,700
  12%   $17,701     - $67,450
  22%   $67,451     - $105,700
  24%   $105,701    - $201,775
  32%   $201,776    - $256,200
  35%   $256,201    - $640,600
  37%   $640,601+

Brackets apply to TAXABLE income (= AGI minus standard or itemized deduction).

### 3.3 Long-term capital gains and qualified dividends

LTCG/QDI stack ON TOP of ordinary income for bracket purposes. They are
taxed last.

  0%    Single up to $49,450     MFJ up to $98,900     HoH up to $66,200
  15%   Single up to $545,500    MFJ up to $613,700    HoH up to $579,600
  20%   Above the 15% ceiling

Critical for conversions: a conversion adds ORDINARY income, which can
push LTCG that was previously in the 0% bracket up into the 15% bracket.
The "tax cost" of a conversion includes this lost 0% LTCG capacity.

### 3.4 IRMAA (Medicare Part B + Part D surcharges)

Standard 2026 Part B premium: $202.90/month per person.

IRMAA uses MAGI from the tax return filed two years earlier. A 2026
conversion drives 2028 IRMAA. MAGI for IRMAA = AGI + tax-exempt muni
interest. (No deduction-add-backs like ACA MAGI; this is its own MAGI
definition.)

IRMAA is a CLIFF, not a phase-in. One dollar over a tier threshold = full
tier surcharge.

  Tier 0 (none):    Single <= $109,000     MFJ <= $218,000
  Tier 1 (1.4x):    Single <= $137,000     MFJ <= $274,000
  Tier 2 (2.0x):    Single <= $171,000     MFJ <= $342,000
  Tier 3 (2.6x):    Single <= $205,000     MFJ <= $410,000
  Tier 4 (3.2x):    Single <  $500,000     MFJ <  $750,000
  Tier 5 (3.4x):    Single >= $500,000     MFJ >= $750,000

Approximate Part B monthly cost by tier: $202.90, $284, $406, $528, $649,
$690. Add Part D surcharge (~$15 to $91/month) on top.

Annual all-in cost difference between Tier 0 and Tier 5 is roughly
$6,900 per person, or $13,800 for a couple. That is the cost of going
$1 over the wrong line on a single tax return.

The calculator MUST treat IRMAA tier boundaries as hard ceilings if the
user is or will be 63+ (since age 65 IRMAA is driven by age-63 MAGI).

### 3.5 Social Security taxation (provisional income)

Provisional income = AGI + tax-exempt interest + 0.5 * SS benefits.

Thresholds (NOT inflation indexed; same since 1994):

  Single / HoH:      lower $25,000     upper $34,000
  MFJ:               lower $32,000     upper $44,000

Behavior:
  - Provisional below lower: 0% of SS benefits taxable.
  - Between lower and upper: up to 50% of benefits taxable.
  - Above upper: up to 85% of benefits taxable.

Effective marginal rates inside the phase-in zones can be 1.5x or 1.85x
the headline bracket. Example: in the 12% bracket, an extra dollar of
conversion income causes $0.85 of SS benefits to also become taxable, so
the true marginal rate on that conversion dollar is 12% * 1.85 = 22.2%.
This "Social Security tax torpedo" is a major reason to convert BEFORE
claiming SS.

### 3.6 ACA premium tax credit cliff

The enhanced subsidies (American Rescue Plan + Inflation Reduction Act)
that removed the 400% FPL cliff EXPIRED at end of 2025. Cliff is back
in 2026.

400% FPL income limits for 2026 (rough, varies by household size):

  1-person household:   $62,600
  2-person household:   $84,600
  4-person household:   $128,600

If MAGI (ACA's MAGI = AGI + tax-exempt interest + non-taxed SS) exceeds
400% FPL by even $1, the entire premium tax credit must be repaid at
tax time. This can be $5k to $20k+.

For users buying ACA coverage (typical for early retirees pre-Medicare),
the ACA cliff is the binding constraint, not the IRMAA cliff. The
calculator must check if user is on ACA and respect this ceiling.

### 3.7 NIIT (Net Investment Income Tax)

3.8% extra tax on the lesser of:
  - net investment income (interest, dividends, capital gains, rental,
    passive business income, NOT IRA distributions or conversions
    themselves), or
  - MAGI minus the threshold.

Thresholds (NOT indexed):
  Single        $200,000
  MFJ           $250,000
  MFS           $125,000

A conversion does NOT itself get hit with NIIT (retirement distributions
are not investment income). BUT the conversion raises MAGI, which can drag
OTHER investment income (taxable account dividends, capital gains) over
the NIIT threshold and trigger the 3.8% on those.

### 3.8 RMD ages (SECURE Act 2.0)

  Born 1950 or earlier:    RMD started at 70.5 or 72
  Born 1951-1959:          RMD starts at 73
  Born 1960 or later:      RMD starts at 75

First RMD can be delayed to April 1 of the year after you turn RMD-age,
but doing that doubles up two RMDs in one tax year, which is usually bad.

### 3.9 State income tax

Highly variable. Categories the calculator should distinguish:

  - No state income tax (FL, TX, NV, WA, TN, NH, SD, WY, AK): conversions
    cost nothing extra at the state level.
  - States that do not tax retirement income or have generous exclusions
    (PA, IL, MS, IA partial, etc.): may not tax the conversion at all.
  - States with full taxation on conversions (CA, NY, NJ, OR, etc.):
    add 4% to 13.3% to the marginal cost.

Plan: if user expects to relocate (e.g., retire from CA to FL), the
optimization may say "do not convert until after the move." This is a
huge optimization lever.

---

## 4. Strategy frameworks

### 4.1 Bracket-fill (the basic algorithm)

  1. Project this year's pre-conversion taxable income (wages, interest,
     pensions, LTCG, taxable SS, etc.).
  2. Identify the "target ceiling": the top of whichever bracket you want
     to stop at (typically the 12%, 22%, or 24% bracket).
  3. Convert (target_ceiling - current_taxable_income) dollars.

This is correct in principle but ignores all the cliffs (IRMAA, ACA, SS,
NIIT). A real bracket-fill replaces "target_ceiling" with:

  effective_ceiling = min(
    chosen federal bracket top,
    next IRMAA tier ceiling,
    400% FPL line (if on ACA),
    NIIT threshold (if it would drag investment income),
    SS provisional-income upper bound (if currently in the phase-in),
    state-specific cliffs (if any),
  )

The calculator's per-year output is exactly this min().

### 4.2 Conversion ladder (early retirement)

Designed for users retiring before 59.5 who want to access Roth principal
penalty-free. Each year you convert a chunk that you intend to spend 5
years later. After 5 years of seeding, you have a continuous pipeline of
"matured" conversion principal you can withdraw without the 10% penalty.

This only matters if user retires before 59.5 AND wants to draw from
the IRA before then. Past 59.5, ladders are unnecessary.

### 4.3 Pre-RMD window (the prime conversion years)

For most users the highest-leverage years are:

  - After last paycheck (income drops)
  - Before claiming Social Security (provisional income still low)
  - Before age 63 (if they will be on Medicare; IRMAA lookback bites at 65)
  - Before RMD age 73/75 (RMDs themselves fill low brackets)

This is the window where bracket-fill conversions are typically
"profitable" even compared to leaving the money in Traditional. The
calculator should explicitly identify this window per-user.

### 4.4 Widow's penalty preemption

When a couple drops to a single filer:
  - Brackets compress to roughly half-width.
  - Standard deduction drops.
  - IRMAA thresholds drop to roughly half.
  - SS taxation thresholds drop.

A surviving spouse with a Traditional IRA balance can land in 24%-32%
brackets where the couple was in 12%-22%. Preemptive conversions while
both spouses are alive are one of the highest-value moves available
to older couples. The calculator should flag this if user is married
and 60+, with explicit modeling of the survivor scenario.

### 4.5 Break-even tax rate (BETR)

Source: Vanguard 2025 (Bruno, DiJoseph). The right comparison is NOT
"my marginal rate today vs my expected rate in retirement." The true
break-even includes:

  - Tax paid out of taxable account today (loses future tax drag).
  - Future tax drag avoided by shrinking the Traditional.
  - The "tax-equivalent" growth of Roth vs Traditional.

The simplified BETR formula:

  BETR = T_now * (1 - tax_drag_factor)

where tax_drag_factor reflects how much of the taxable-account dollars
used to pay conversion tax would have been eroded by annual taxation
on dividends, interest, and turnover. With long horizons and inefficient
taxable holdings, BETR can be SIGNIFICANTLY lower than T_now, meaning
conversions pay off even if future rates are lower.

Implication: do not assume "I'll be in a lower bracket later, so don't
convert." Run the actual BETR for each user.

### 4.6 Roth-to-heirs (legacy planning)

Inherited Traditional IRAs are taxable to the heir at their (often peak-
earnings) bracket, must be drained in 10 years post-SECURE-Act.
Inherited Roth IRAs are tax-free to the heir over the same 10 years.

If user's heirs are in higher brackets than user (typical: parent in
retirement bracket, child in working bracket), conversions are hugely
valuable for legacy. The calculator should accept "heir's expected
marginal rate" as an input and weight bequests accordingly.

---

## 5. The optimization framework (calculator algorithm)

### 5.1 Inputs

User profile:
  - Filing status (Single / MFJ / HoH / MFS)
  - Both spouses' dates of birth (if MFJ)
  - State of residence (current and expected future)
  - Will spouse predecease and when (probabilistic; default to actuarial)

Account balances:
  - Traditional IRA balance (pretax)
  - Traditional IRA basis (after-tax, from Form 8606 history)
  - 401k/403b/TSP balances (separate; not pro-rata-mixed)
  - Roth IRA balance and first-Roth-contribution year (for Clock A)
  - Per-conversion history (for Clock B)
  - Taxable brokerage balance (source of tax payment)
  - HSA balance
  - Cost basis of taxable account (for tax-drag estimate)

Income forecast:
  - Wages, self-employment, business income by year until retirement
  - Pensions (start year, COLA, taxable portion)
  - Social Security (start year per spouse, monthly benefit)
  - Other annuities or rental income

Spending forecast:
  - Annual living expenses, with inflation
  - Lumpy items (home purchase, college, etc.)
  - Healthcare assumption (employer / ACA / Medicare)

Assumptions (defaults provided):
  - Investment returns by account type (e.g., 6% real)
  - Inflation (e.g., 2.5%)
  - Future federal tax-rate scenario (TCJA-extended permanent /
    pre-TCJA reversion / user's own scenario)
  - Heir's expected marginal rate (default: same as user)
  - Life expectancy (default: actuarial table; allow override)

### 5.2 Hard constraints (per year)

These are the "do not cross" lines:

  1. RMD-first: if RMD year, take RMD before computing conversion room.
  2. ACA cliff: if user is on ACA, MAGI must stay below 400% FPL.
  3. IRMAA tier: choose target tier per user preference; conversion
     amount must keep MAGI below that tier's ceiling for the relevant
     filing year (year T drives IRMAA in T+2).
  4. NIIT: optionally avoid crossing the threshold (soft constraint).
  5. Cash to pay tax: conversion_tax_owed <= taxable_account_liquidity.
  6. Inherited IRAs: not convertible (filter from balance).

### 5.3 Objective function

Minimize lifetime tax NPV:

  total_cost = sum over years t of:
                 federal_income_tax(t)
               + state_income_tax(t)
               + IRMAA(t)
               + ACA_clawback(t)
               + NIIT(t)
               + 10%_penalty(t, if early withdrawal)
               + opportunity_cost(tax_paid_from_taxable, t)
            + heir_tax(remaining_balances at death)

discounted at user's chosen real rate.

Equivalently maximize total real after-tax wealth at end of horizon
(at user's death + heir's 10-year drawdown).

### 5.4 Solver

For each year from now to (end-of-life-expectancy + 10 for heirs):

  1. Compute pre-conversion taxable income from forecast.
  2. Compute pre-conversion MAGI (for IRMAA, ACA, NIIT).
  3. Compute the binding ceiling = min(...) across all active constraints.
  4. Compute conversion room = ceiling - pre-conversion MAGI.
  5. Limit by Traditional balance available.
  6. Limit by taxable cash available to pay tax.
  7. Compute marginal cost of last dollar at this conversion size.
  8. If marginal cost < expected future marginal cost (BETR check),
     accept the conversion.
  9. Update balances and proceed to next year.

Refinement: instead of greedy per-year, solve the full multi-year problem.
Greedy under-converts when "saving room" for a future low-income year is
better. A proper solver enumerates plausible per-year amounts and picks
the global optimum. For v1 the calculator can do greedy with a published
caveat.

### 5.5 Output

For each year:
  - Recommended conversion amount
  - Federal tax due
  - State tax due
  - IRMAA impact in year+2
  - ACA impact (if applicable)
  - Cumulative remaining Traditional balance
  - Cumulative Roth balance (with growth)
  - Per-conversion 5-year-clock maturity dates

Summary:
  - Lifetime tax saved vs no-conversion baseline
  - Lifetime tax saved vs convert-everything-now
  - Heir's after-tax inheritance under each scenario
  - Sensitivity to future-rate assumption
  - The single year where the largest conversion happens (for cash-flow
    planning)

---

## 6. Worked examples

These are illustrative. The website will produce per-user numbers.

### 6.1 Persona A: pre-retiree couple, age 60, $1.5M Traditional, MFJ

  Wages: $200k combined this year, retiring at 62.
  SS claim age: 70 each.
  State: TX (no income tax).
  ACA: yes, between 62 and 65.
  Other income at retirement: $20k taxable interest.

Pre-retirement (age 60-61): wages already in 22-24% bracket, conversion
costly. Convert little or zero.

ACA window (age 62-64): tight ceiling at 400% FPL (~$84,600). Pre-
conversion AGI is ~$20k, so room is ~$64k/year of conversion. State 0.
This is the binding constraint.

Pre-Medicare-IRMAA (age 64): same as above; IRMAA lookback is 2 years,
so age-63 income drives age-65 IRMAA. Stay within IRMAA Tier 0
(MAGI <= $218k) at age 63 = comfortably above ACA cliff anyway.

Medicare gap (age 65-69, no SS yet): no ACA constraint. Convert up to
top of 22% bracket (~$211k MFJ taxable) or top of IRMAA Tier 0 ($218k
MAGI), whichever binds. Conversion room ~$190k/year. But also drives
IRMAA at age 67. Pick a target tier and stick to it.

Post-SS (age 70+): SS = ~$80k combined. Provisional income drives
85% of SS taxable. RMDs start at 73. Conversion room small and cheap
years are over.

Output: front-load the Medicare-gap window (5 years at ~$150k-$190k
each), do smaller bracket-fills before, stop after RMDs start.

### 6.2 Persona B: single, age 67, $800k Traditional, retired, no SS yet

  Pension: $30k.
  State: CA (full conversion taxation, ~9.3% marginal).
  IRMAA: already on Medicare; today's MAGI affects 2028 IRMAA.

Top of 22% bracket Single = $105,700 taxable. Pre-standard-deduction
gross = ~$121,800. Pension uses $30k, leaving ~$91,800 of conversion
room at 22% federal + ~9.3% CA = ~31.3% marginal.

But IRMAA Tier 0 ceiling Single = $109,000 MAGI. Pension $30k + conversion
$79k = $109,000 MAGI exactly at the line. Convert $79k/year, not $91k.

Six years of $79k = ~$474k converted, leaving $326k in Traditional at age
73 when RMDs start. RMD on $326k at age 73 = ~$326k / 26.5 = ~$12.3k
first RMD, growing slowly. Manageable.

Output: $79k/year for 6 years.

---

## 7. Inputs/outputs spec for the website

### 7.1 Page flow (suggested)

  1. Profile: filing status, ages, state, retirement timing.
  2. Balances: account-by-account inputs with help text.
  3. Income forecast: simple table or chart, year-by-year editable.
  4. Constraints toggle: avoid IRMAA tier X / stay below ACA cliff /
     don't trigger NIIT / etc.
  5. Future-rate scenario picker: TCJA-extended / pre-TCJA / custom.
  6. Results: year-by-year conversion plan + sensitivity panel.

### 7.2 Backend API surface (matches phonics/shooter conventions)

REST. Hexagonal layout (domain -> ports -> adapters).

Domain types (rough):

  type Profile struct {
      FilingStatus    FilingStatus
      DOBs            []time.Time
      State           StateCode
      ExpectedState   StateCode
      RetirementYear  int
      ACAUntilYear    int
      MedicareYear    int
      RMDStartAge     int   // 73 or 75 per SECURE 2.0
  }

  type Balances struct {
      TraditionalIRA   Money
      TraditionalBasis Money
      EmployerPretax   Money  // 401k etc., not pro-rata-mixed
      Roth             Money
      RothFirstYear    int
      Conversions      []ConversionRecord
      Taxable          Money
      TaxableBasis     Money
      HSA              Money
  }

  type IncomeForecast struct {
      ByYear map[int]IncomeYear
  }

  type Plan struct {
      Years []YearRecommendation
      Summary PlanSummary
  }

Solver port:

  type ConversionSolver interface {
      Solve(p Profile, b Balances, f IncomeForecast,
            opts SolverOptions) (Plan, error)
  }

Reference-data adapter:

  type TaxTables interface {
      Brackets(year int, status FilingStatus) []Bracket
      LTCG(year int, status FilingStatus) []Bracket
      StandardDeduction(year int, status FilingStatus, age65 bool) Money
      IRMAA(year int, status FilingStatus) []IRMAATier
      ACAFPL(year int, householdSize int) Money
      NIITThreshold(status FilingStatus) Money
      SSThresholds(status FilingStatus) (lower, upper Money)
      RMDDivisor(age int) float64
      StateRules(state StateCode) StateTaxRules
  }

State adapter is the messy one. Defer to a static JSON file per state
that captures: marginal rates, retirement-income exclusions, age-based
exemptions, conversion-specific quirks.

### 7.3 Frontend (matches solo-adventure / phonics conventions)

Next.js. One main calculator page. Year-by-year results table, plus
a chart of "tax bracket fill" per year. Sensitivity panel (slider for
future federal rate, IRMAA target tier, return assumption).

No SSE / WebSocket needed. Plain REST POST of the profile, response
is the full Plan.

---

## 7.4 v1 calculator: sensitivity matrix (what is actually shipped)

The v1 calculator is intentionally simpler than the full optimizer in section
5. It is a comparison tool, not a recommender.

Goal: let the user compare the tax-to-pay and ending 401k balances (traditional
and Roth) under the joint variation of two variables: annual conversion amount
and rate of return.

Fixed inputs:
  - Age, birth year (for RMD age)
  - Total 401k, traditional/Roth split (default 70/30)
  - Filing status
  - Annual other taxable income (held flat across the horizon)
  - Horizon years (default 10)
  - Include RMDs flag (default on)

Variable inputs (lists):
  - Rates of return  (e.g., 10, 15, 20, 25 percent)
  - Annual conversion amounts (e.g., 0, 25k, 50k, 100k, 200k)

Output: cross product of the two lists. For each (rate, conversion) pair, a
year-by-year projection of:
  - RMD (forced once age is at SECURE 2.0 RMD age)
  - Conversion (capped by traditional balance after RMD)
  - Taxable income (other_income + conversion + RMD)
  - Federal tax (ordinary brackets only, after standard deduction)
  - Ending traditional, Roth, and total

The UI presents:
  1. A summary grid: rows = conversion cases, columns = rates, cell = total
     tax paid + ending balance (trad / Roth split).
  2. A drill-in table: pick a rate, see one year-by-year table per conversion
     case stacked vertically.

Assumptions (v1):
  - Tax is paid from outside the 401k (100% of conversion lands in Roth).
  - No state tax, no IRMAA, no NIIT, no SS taxation phase-in. Pure federal
    ordinary-income tax.
  - Other income is held constant nominal across years.
  - Conversion amount is held constant nominal across years.
  - RMDs use SECURE 2.0 ages (73 for born 1951-1959, 75 for born 1960+).

The full constraint stack (ACA cliff, IRMAA tiers, SS torpedo, widow's
penalty) lives in section 3 and section 4; the v2 calculator (section 5)
will use them as binding constraints in an optimizer.

## 8. Open questions and v1 scope

For v1 (suggested), include:
  - Federal brackets, IRMAA, SS taxation, NIIT, ACA cliff
  - Pro-rata, 5-year clocks, RMD age
  - Greedy per-year solver with cliff-respecting min()
  - One state model: "no state tax" (TX/FL/etc.) plus "high-tax" (CA)
    plus a generic flat-rate state.

Defer to v2:
  - Multi-year global optimum solver (instead of greedy)
  - Probabilistic widow's penalty modeling (joint mortality table)
  - State-by-state retirement-income exclusion rules
  - Backdoor / mega-backdoor Roth integration
  - Charitable-giving QCD interactions (for 70.5+)
  - Volatility timing (when in the year to convert)

Key references to keep current annually:
  - IRS Rev. Proc. (sets next year's brackets) - released October-ish.
  - CMS Medicare premium notice - released November.
  - HHS poverty guidelines - released January.
  - State legislature changes - varies.

---

## 9. Sources

Federal tax brackets and standard deduction:
  - Tax Foundation 2026 brackets:
    https://taxfoundation.org/data/all/federal/2026-tax-brackets/
  - IRS inflation adjustments 2026:
    https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill

TCJA / OBBBA:
  - Tax Foundation TCJA-expiry analysis:
    https://taxfoundation.org/blog/2026-tax-brackets-tax-cuts-and-jobs-act-expires/
  - Bipartisan Policy Center on TCJA bill:
    https://bipartisanpolicy.org/explainer/paying-the-2025-tax-bill-income-tax-rates-and-thresholds/

IRMAA:
  - The Finance Buff IRMAA brackets:
    https://thefinancebuff.com/medicare-irmaa-income-brackets.html
  - Kiplinger 2026 Medicare premiums:
    https://www.kiplinger.com/retirement/medicare/medicare-premiums-2026-irmaa-brackets-and-surcharges-for-parts-b-and-d

ACA cliff:
  - CNBC ACA subsidy cliff 2026:
    https://www.cnbc.com/2026/01/06/aca-subsidy-cliff-tax-bills.html
  - healthinsurance.org cliff return:
    https://www.healthinsurance.org/blog/marketplace-enrollees-face-return-of-the-subsidy-cliff/

NIIT:
  - IRS Topic 559:
    https://www.irs.gov/taxtopics/tc559
  - IRS NIIT Q&A:
    https://www.irs.gov/newsroom/questions-and-answers-on-the-net-investment-income-tax

Social Security taxation:
  - taxcalchub 2026 SS taxability:
    https://taxcalchub.com/guides/retirement/taxable-social-security-benefits-2026/
  - CRS SS benefit taxation:
    https://www.congress.gov/crs-product/IF11397

SECURE Act 2.0 / RMD ages:
  - Kitces SECURE 2.0 breakdown:
    https://www.kitces.com/blog/secure-act-2-omnibus-2022-hr-2954-rmd-75-529-roth-rollover-increase-qcd-student-loan-match/
  - Ameritas SECURE 2.0 Roth/RMD 2026:
    https://www.ameritas.com/insights/secure-act-2-0-roth-rmd-rules-for-2026/

Conversion strategy:
  - Kitces marginal rate of conversion:
    https://www.kitces.com/blog/roth-conversion-analysis-value-calculate-timing-true-marginal-tax-rate-equivalency-principle/
  - Vanguard BETR paper:
    https://corporate.vanguard.com/content/dam/corp/research/pdf/a_betr_approach_to_roth_conversions_072025.pdf
  - FPA Journal "Arithmetic of Roth Conversions":
    https://www.financialplanningassociation.org/learning/publications/journal/MAY23-arithmetic-roth-conversions-OPEN

Widow's penalty:
  - RCS Planning widow penalty:
    https://rcsplanning.com/widow-penalty/
  - Purpose Built FS marriage penalty in widowhood:
    https://www.purposebuiltfs.com/blog/the-marriage-penalty-in-widowhood-how-roth-conversions-can-help

Capital gains:
  - Tax Foundation 2026 (same URL as brackets above)
  - Kiplinger 2026 capital gains:
    https://www.kiplinger.com/taxes/irs-updates-capital-gains-tax-thresholds
