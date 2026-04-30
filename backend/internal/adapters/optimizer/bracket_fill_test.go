package optimizer

import (
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ridopark/roth-converter/backend/internal/domain"
	"github.com/ridopark/roth-converter/backend/internal/ports"
)

type fakeRepo struct{ tables domain.TaxTables }

func (f fakeRepo) Get(int) (domain.TaxTables, error) { return f.tables, nil }

func tables2026() domain.TaxTables {
	return domain.TaxTables{
		Year: 2026,
		StandardDeduction: map[domain.FilingStatus]float64{
			domain.FilingMFJ:    32200,
			domain.FilingSingle: 16100,
		},
		OrdinaryBrackets: map[domain.FilingStatus][]domain.Bracket{
			domain.FilingMFJ: {
				{Rate: 0.10, Max: 24800},
				{Rate: 0.12, Max: 100800},
				{Rate: 0.22, Max: 211400},
				{Rate: 0.24, Max: 403550},
				{Rate: 0.32, Max: 512450},
				{Rate: 0.35, Max: 768700},
				{Rate: 0.37, Max: 0},
			},
		},
		RMDDivisors:   map[int]float64{73: 26.5, 74: 25.5, 75: 24.6},
		StateTaxRates: map[string]float64{},
		NoTaxStates:   map[string]bool{},
		IRMAATiers: map[domain.FilingStatus][]domain.IRMAATier{
			domain.FilingMFJ: {
				{Label: "standard", MaxMAGI: 218000, AnnualSurchargePerPerson: 0},
				{Label: "tier1", MaxMAGI: 274000, AnnualSurchargePerPerson: 1147},
				{Label: "tier2", MaxMAGI: 342000, AnnualSurchargePerPerson: 2873},
				{Label: "tier3", MaxMAGI: 410000, AnnualSurchargePerPerson: 4595},
				{Label: "tier4", MaxMAGI: 750000, AnnualSurchargePerPerson: 6273},
				{Label: "tier5", MaxMAGI: 0, AnnualSurchargePerPerson: 6935},
			},
		},
		SSThresholds: map[domain.FilingStatus]domain.SSThreshold{
			domain.FilingMFJ: {Lower: 32000, Upper: 44000},
		},
	}
}

func ptrBool(b bool) *bool { return &b }

func newOpt(repo ports.TaxTablesRepo) *BracketFill { return New(repo, zerolog.Nop()) }

func TestOptimize_Fill12Bracket(t *testing.T) {
	// MFJ, $50k other income, $1M trad, no RMD, target 12% bracket.
	// Each year headroom = 100,800 - (50,000 - 32,200) = 83,000.
	// Conv = $83,000 capped by trad balance.
	o := newOpt(fakeRepo{tables: tables2026()})
	plan, err := o.Solve(domain.OptimizeRequest{
		Profile: domain.Profile{
			Age:               60,
			BirthYear:         1966,
			Total401k:         1_000_000,
			TraditionalPct:    1.0,
			FilingStatus:      domain.FilingMFJ,
			AnnualOtherIncome: 50_000,
			HorizonYears:      3,
		},
		RateOfReturn:      0,
		TargetBracketRate: 0.12,
	})
	require.NoError(t, err)
	assert.InDelta(t, 100800, plan.TargetBracketTop, 0.01)
	for _, y := range plan.Plan.Years {
		assert.InDelta(t, 83000, y.Conversion, 0.01)
		assert.InDelta(t, 100800, y.TaxableIncome-32200, 0.01)
	}
}

func TestOptimize_FillCappedByTradBalance(t *testing.T) {
	// $100k trad, target 22% bracket would want $193,600/yr but only $100k available.
	// First year converts $100k, after which trad runs out.
	o := newOpt(fakeRepo{tables: tables2026()})
	plan, err := o.Solve(domain.OptimizeRequest{
		Profile: domain.Profile{
			Age:               60,
			BirthYear:         1966,
			Total401k:         100_000,
			TraditionalPct:    1.0,
			FilingStatus:      domain.FilingMFJ,
			AnnualOtherIncome: 50_000,
			HorizonYears:      3,
		},
		RateOfReturn:      0,
		TargetBracketRate: 0.22,
	})
	require.NoError(t, err)
	assert.InDelta(t, 100_000, plan.Plan.Years[0].Conversion, 0.01)
	assert.InDelta(t, 0, plan.Plan.Years[1].Conversion, 0.01)
	assert.InDelta(t, 0, plan.Plan.Years[2].Conversion, 0.01)
	assert.InDelta(t, 100_000, plan.Plan.Summary.TotalConverted, 0.01)
}

func TestOptimize_OtherIncomeAboveBracket(t *testing.T) {
	// Other income alone exceeds top of 12% bracket -> headroom 0 -> no conversion.
	o := newOpt(fakeRepo{tables: tables2026()})
	plan, err := o.Solve(domain.OptimizeRequest{
		Profile: domain.Profile{
			Age:               60,
			BirthYear:         1966,
			Total401k:         1_000_000,
			TraditionalPct:    1.0,
			FilingStatus:      domain.FilingMFJ,
			AnnualOtherIncome: 200_000,
			HorizonYears:      2,
		},
		RateOfReturn:      0,
		TargetBracketRate: 0.12,
	})
	require.NoError(t, err)
	for _, y := range plan.Plan.Years {
		assert.InDelta(t, 0, y.Conversion, 0.01)
	}
}

func TestOptimize_InvalidTarget(t *testing.T) {
	// 37% bracket has Max=0 (sentinel for infinity) -> error.
	o := newOpt(fakeRepo{tables: tables2026()})
	_, err := o.Solve(domain.OptimizeRequest{
		Profile: domain.Profile{
			Age:            60,
			BirthYear:      1966,
			Total401k:      100_000,
			TraditionalPct: 1.0,
			FilingStatus:   domain.FilingMFJ,
			HorizonYears:   1,
		},
		TargetBracketRate: 0.37,
	})
	require.Error(t, err)
}

func TestOptimize_RespectIRMAACapsAtStandardTier(t *testing.T) {
	// Plan success criterion 3: with respect_irmaa=true at age >= 63, fill-22%
	// caps at the IRMAA standard tier top instead of the 22% bracket top.
	//
	// MFJ, age 65, $50k other income, no RMD, target 22% bracket.
	// Without IRMAA cap: headroom = 211,400 - max(0, 50,000-32,200) = 193,600.
	// Pre-deduction MAGI would be 50k + 193.6k = 243.6k > $218k tier-1 boundary.
	// With IRMAA cap: conv capped so MAGI <= 218k, i.e. conv = 218k - 50k = 168k.
	o := newOpt(fakeRepo{tables: tables2026()})
	uncapped, err := o.Solve(domain.OptimizeRequest{
		Profile: domain.Profile{
			Age:               65,
			BirthYear:         1961,
			Total401k:         3_000_000,
			TraditionalPct:    1.0,
			FilingStatus:      domain.FilingMFJ,
			AnnualOtherIncome: 50_000,
			HorizonYears:      1,
		},
		RateOfReturn:      0,
		TargetBracketRate: 0.22,
		RespectIRMAA:      ptrBool(false),
	})
	require.NoError(t, err)
	capped, err := o.Solve(domain.OptimizeRequest{
		Profile: domain.Profile{
			Age:               65,
			BirthYear:         1961,
			Total401k:         3_000_000,
			TraditionalPct:    1.0,
			FilingStatus:      domain.FilingMFJ,
			AnnualOtherIncome: 50_000,
			HorizonYears:      1,
		},
		RateOfReturn:      0,
		TargetBracketRate: 0.22,
		// Default RespectIRMAA == nil -> true.
	})
	require.NoError(t, err)

	uncappedConv := uncapped.Plan.Years[0].Conversion
	cappedConv := capped.Plan.Years[0].Conversion
	assert.Greater(t, uncappedConv, cappedConv,
		"uncapped (%v) must exceed capped (%v)", uncappedConv, cappedConv)
	assert.InDelta(t, 193_600, uncappedConv, 1.0)
	assert.InDelta(t, 168_000, cappedConv, 1.0)
}

func TestOptimize_RespectIRMAA_DoesNotApplyBefore63(t *testing.T) {
	// At age 60, the conversion's MAGI doesn't affect IRMAA (lookback hits at
	// age 62, before Medicare). Default respect_irmaa=true must NOT cap
	// conversion below the 22% bracket top.
	o := newOpt(fakeRepo{tables: tables2026()})
	plan, err := o.Solve(domain.OptimizeRequest{
		Profile: domain.Profile{
			Age:               60,
			BirthYear:         1966,
			Total401k:         3_000_000,
			TraditionalPct:    1.0,
			FilingStatus:      domain.FilingMFJ,
			AnnualOtherIncome: 50_000,
			HorizonYears:      1,
		},
		RateOfReturn:      0,
		TargetBracketRate: 0.22,
	})
	require.NoError(t, err)
	assert.InDelta(t, 193_600, plan.Plan.Years[0].Conversion, 1.0)
}

func TestOptimize_PopulatesIRMAATiers(t *testing.T) {
	o := newOpt(fakeRepo{tables: tables2026()})
	plan, err := o.Solve(domain.OptimizeRequest{
		Profile: domain.Profile{
			Age:               60,
			BirthYear:         1966,
			Total401k:         100_000,
			TraditionalPct:    1.0,
			FilingStatus:      domain.FilingMFJ,
			AnnualOtherIncome: 50_000,
			HorizonYears:      1,
		},
		RateOfReturn:      0,
		TargetBracketRate: 0.12,
	})
	require.NoError(t, err)
	require.NotEmpty(t, plan.IRMAATiers)
	assert.True(t, plan.RespectIRMAA)
}

func TestOptimize_BackwardCompatFlow(t *testing.T) {
	// Pre-existing v1 flow path (TestOptimize_Fill12Bracket) without any new
	// fields set: behavior must be identical -- $83k/yr conversion at $50k
	// other income, $1M trad, target 12% bracket, age 60.
	o := newOpt(fakeRepo{tables: tables2026()})
	plan, err := o.Solve(domain.OptimizeRequest{
		Profile: domain.Profile{
			Age:               60,
			BirthYear:         1966,
			Total401k:         1_000_000,
			TraditionalPct:    1.0,
			FilingStatus:      domain.FilingMFJ,
			AnnualOtherIncome: 50_000,
			HorizonYears:      3,
		},
		RateOfReturn:      0,
		TargetBracketRate: 0.12,
	})
	require.NoError(t, err)
	for _, y := range plan.Plan.Years {
		assert.InDelta(t, 83_000, y.Conversion, 0.01)
	}
}

func TestOptimize_InvalidInputs(t *testing.T) {
	o := newOpt(fakeRepo{tables: tables2026()})
	cases := []struct {
		name string
		req  domain.OptimizeRequest
	}{
		{"bad filing status", domain.OptimizeRequest{Profile: domain.Profile{Age: 60, FilingStatus: "garbage"}, TargetBracketRate: 0.12}},
		{"negative balance", domain.OptimizeRequest{Profile: domain.Profile{Age: 60, FilingStatus: domain.FilingMFJ, Total401k: -1}, TargetBracketRate: 0.12}},
		{"zero age", domain.OptimizeRequest{Profile: domain.Profile{Age: 0, FilingStatus: domain.FilingMFJ}, TargetBracketRate: 0.12}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := o.Solve(tc.req)
			require.Error(t, err)
		})
	}
}
