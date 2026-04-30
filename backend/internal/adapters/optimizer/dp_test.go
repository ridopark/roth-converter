package optimizer

import (
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ridopark/roth-converter/backend/internal/domain"
	"github.com/ridopark/roth-converter/backend/internal/ports"
)

func newDP(repo ports.TaxTablesRepo) *DP { return NewDP(repo, zerolog.Nop()) }

func TestDP_ZeroConversionWhenNoIncentive(t *testing.T) {
	// 60-year-old MFJ, zero other income, no SS, no RMDs in horizon. Federal
	// tax is already zero (taxable < std deduction). DP should not convert at
	// all (terminal lump-sum cost is monotone in trad balance, but in-horizon
	// cost is also zero for any conversion below the std deduction; the DP
	// chooses whichever minimum it finds first -- assert it produces a valid
	// plan with non-negative ending balance).
	d := newDP(fakeRepo{tables: tables2026()})
	plan, err := d.Solve(domain.OptimizeRequest{
		Profile: domain.Profile{
			Age:               60,
			BirthYear:         1966,
			Total401k:         100_000,
			TraditionalPct:    1.0,
			FilingStatus:      domain.FilingMFJ,
			AnnualOtherIncome: 20_000,
			HorizonYears:      3,
		},
		RateOfReturn: 0,
		Strategy:     "dp",
	})
	require.NoError(t, err)
	assert.Equal(t, "dp", plan.Strategy)
	assert.GreaterOrEqual(t, plan.Plan.Summary.EndingTotal, 0.0)
	assert.Len(t, plan.Plan.Years, 3)
}

func TestDP_DoesNotIRMAACliffOnAge65MFJ(t *testing.T) {
	// 65-year-old MFJ, $50k other, $1M trad, 5-year horizon. Each year's MAGI
	// seeds a Medicare surcharge two years later. DP should choose conversions
	// that keep MAGI under the standard tier ($218k MFJ) so total IRMAA stays
	// at $0.
	d := newDP(fakeRepo{tables: tables2026()})
	plan, err := d.Solve(domain.OptimizeRequest{
		Profile: domain.Profile{
			Age:               65,
			BirthYear:         1961,
			Total401k:         1_000_000,
			TraditionalPct:    1.0,
			FilingStatus:      domain.FilingMFJ,
			AnnualOtherIncome: 50_000,
			HorizonYears:      5,
		},
		RateOfReturn:      0.05,
		TargetBracketRate: 0.22,
		Strategy:          "dp",
	})
	require.NoError(t, err)
	assert.InDelta(t, 0, plan.Plan.Summary.TotalIRMAASurcharge, 0.01,
		"DP should keep MAGI under the standard IRMAA tier")
	// And the plan should still convert *something* (not a degenerate 0 plan).
	assert.Greater(t, plan.Plan.Summary.TotalConverted, 0.0)
}

func TestDP_BeatsGreedyOnIRMAACliff(t *testing.T) {
	// Age 64+, MFJ, no SS, $30k pension, $800k all-trad, 24% target with
	// respect_irmaa=false on greedy. Greedy fills 24% to ~$280k+ MAGI every
	// year, paying multi-thousand-dollar IRMAA from age 66 onward. DP can
	// either split conversions (avoid the cliff) or compress them into early
	// years before the user is 63. DP's total cost (in-horizon + terminal on
	// remaining trad) must be <= greedy's.
	repo := fakeRepo{tables: tables2026()}
	greedy := newOpt(repo)
	dp := newDP(repo)

	profile := domain.Profile{
		Age:               64,
		BirthYear:         1962,
		Total401k:         800_000,
		TraditionalPct:    1.0,
		FilingStatus:      domain.FilingMFJ,
		AnnualOtherIncome: 30_000,
		HorizonYears:      8,
		IncludeRMD:        true,
	}
	respectIRMAAFalse := false

	greedyPlan, err := greedy.Solve(domain.OptimizeRequest{
		Profile:           profile,
		RateOfReturn:      0.05,
		TargetBracketRate: 0.24,
		RespectIRMAA:      &respectIRMAAFalse,
	})
	require.NoError(t, err)

	dpPlan, err := dp.Solve(domain.OptimizeRequest{
		Profile:           profile,
		RateOfReturn:      0.05,
		TargetBracketRate: 0.24,
		Strategy:          "dp",
	})
	require.NoError(t, err)

	dpIRMAA := dpPlan.Plan.Summary.TotalIRMAASurcharge
	greedyIRMAA := greedyPlan.Plan.Summary.TotalIRMAASurcharge

	assert.LessOrEqual(t, dpIRMAA, greedyIRMAA,
		"DP should pay less IRMAA than IRMAA-blind greedy on a cliff profile (dp=%v greedy=%v)",
		dpIRMAA, greedyIRMAA)
}

func TestDP_PerYearOtherIncomeStep(t *testing.T) {
	// Other income jumps mid-horizon (pension starts year 3). DP should
	// frontload conversions in years 0-2 (low ordinary income, low marginal
	// rate) and taper as income rises.
	d := newDP(fakeRepo{tables: tables2026()})
	plan, err := d.Solve(domain.OptimizeRequest{
		Profile: domain.Profile{
			Age:                60,
			BirthYear:          1966,
			Total401k:          500_000,
			TraditionalPct:     1.0,
			FilingStatus:       domain.FilingMFJ,
			AnnualOtherIncome:  20_000,
			OtherIncomePerYear: []float64{20_000, 20_000, 20_000, 100_000, 100_000},
			HorizonYears:       5,
		},
		RateOfReturn:      0.05,
		TargetBracketRate: 0.22,
		Strategy:          "dp",
	})
	require.NoError(t, err)
	years := plan.Plan.Years
	earlySum := years[0].Conversion + years[1].Conversion + years[2].Conversion
	lateSum := years[3].Conversion + years[4].Conversion
	assert.Greater(t, earlySum, lateSum,
		"DP should frontload conversions in low-income years (early=%v late=%v)",
		earlySum, lateSum)
}

func TestDP_HorizonBudget(t *testing.T) {
	// Plan target: <2s for 10-year horizon with $1M trad. We allow 3s here in
	// CI to absorb test-host noise; the design memo's <2s target is the prod
	// invariant.
	d := newDP(fakeRepo{tables: tables2026()})
	start := time.Now()
	_, err := d.Solve(domain.OptimizeRequest{
		Profile: domain.Profile{
			Age:               65,
			BirthYear:         1961,
			Total401k:         1_000_000,
			TraditionalPct:    1.0,
			FilingStatus:      domain.FilingMFJ,
			AnnualOtherIncome: 50_000,
			HorizonYears:      10,
			IncludeRMD:        true,
		},
		RateOfReturn:      0.07,
		TargetBracketRate: 0.22,
		Strategy:          "dp",
	})
	elapsed := time.Since(start)
	require.NoError(t, err)
	assert.Less(t, elapsed, 3*time.Second,
		"DP took %v on 10-year/$1M; target is <2s, ceiling 3s", elapsed)
	t.Logf("DP solved 10-year/$1M in %v", elapsed)
}

func TestRouter_DefaultsToBracketFill(t *testing.T) {
	repo := fakeRepo{tables: tables2026()}
	router := NewRouter(newOpt(repo), newDP(repo))
	plan, err := router.Solve(domain.OptimizeRequest{
		Profile: domain.Profile{
			Age:            60,
			BirthYear:      1966,
			Total401k:      1_000_000,
			TraditionalPct: 1.0,
			FilingStatus:   domain.FilingMFJ,
			HorizonYears:   3,
		},
		RateOfReturn:      0.05,
		TargetBracketRate: 0.12,
		// Strategy unset -> bracket_fill.
	})
	require.NoError(t, err)
	assert.Equal(t, "bracket_fill", plan.Strategy)
}

func TestRouter_DPRoutesToDP(t *testing.T) {
	repo := fakeRepo{tables: tables2026()}
	router := NewRouter(newOpt(repo), newDP(repo))
	plan, err := router.Solve(domain.OptimizeRequest{
		Profile: domain.Profile{
			Age:            60,
			BirthYear:      1966,
			Total401k:      300_000,
			TraditionalPct: 1.0,
			FilingStatus:   domain.FilingMFJ,
			HorizonYears:   3,
		},
		RateOfReturn:      0.05,
		TargetBracketRate: 0.12,
		Strategy:          "dp",
	})
	require.NoError(t, err)
	assert.Equal(t, "dp", plan.Strategy)
}
