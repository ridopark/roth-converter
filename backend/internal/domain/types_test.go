package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func tablesWithIRMAAandSS() TaxTables {
	return TaxTables{
		StandardDeduction: map[FilingStatus]float64{
			FilingMFJ:    32200,
			FilingSingle: 16100,
		},
		IRMAATiers: map[FilingStatus][]IRMAATier{
			FilingMFJ: {
				{Label: "standard", MaxMAGI: 218000, AnnualSurchargePerPerson: 0},
				{Label: "tier1", MaxMAGI: 274000, AnnualSurchargePerPerson: 1147},
				{Label: "tier2", MaxMAGI: 342000, AnnualSurchargePerPerson: 2873},
				{Label: "tier3", MaxMAGI: 410000, AnnualSurchargePerPerson: 4595},
				{Label: "tier4", MaxMAGI: 750000, AnnualSurchargePerPerson: 6273},
				{Label: "tier5", MaxMAGI: 0, AnnualSurchargePerPerson: 6935},
			},
			FilingSingle: {
				{Label: "standard", MaxMAGI: 109000, AnnualSurchargePerPerson: 0},
				{Label: "tier1", MaxMAGI: 137000, AnnualSurchargePerPerson: 1147},
				{Label: "tier2", MaxMAGI: 171000, AnnualSurchargePerPerson: 2873},
				{Label: "tier3", MaxMAGI: 205000, AnnualSurchargePerPerson: 4595},
				{Label: "tier4", MaxMAGI: 500000, AnnualSurchargePerPerson: 6273},
				{Label: "tier5", MaxMAGI: 0, AnnualSurchargePerPerson: 6935},
			},
		},
		SSThresholds: map[FilingStatus]SSThreshold{
			FilingMFJ:    {Lower: 32000, Upper: 44000},
			FilingSingle: {Lower: 25000, Upper: 34000},
		},
	}
}

func TestIRMAA_ZeroBeforeMedicareAge(t *testing.T) {
	tt := tablesWithIRMAAandSS()
	assert.Equal(t, 0.0, tt.IRMAA(500000, FilingMFJ, 64))
	assert.Equal(t, 0.0, tt.IRMAA(500000, FilingSingle, 50))
}

func TestIRMAA_ZeroInStandardTier(t *testing.T) {
	tt := tablesWithIRMAAandSS()
	assert.Equal(t, 0.0, tt.IRMAA(180000, FilingMFJ, 70))
	assert.Equal(t, 0.0, tt.IRMAA(50000, FilingSingle, 65))
}

func TestIRMAA_HouseholdDoubleForMFJ(t *testing.T) {
	// Plan success criterion 2: age-66 MFJ, MAGI history in tier 2.
	// Per-person tier-2 surcharge = $2,873; household = $5,746.
	tt := tablesWithIRMAAandSS()
	got := tt.IRMAA(300000, FilingMFJ, 66)
	assert.InDelta(t, 5746, got, 0.01)
}

func TestIRMAA_SingleNotDoubled(t *testing.T) {
	tt := tablesWithIRMAAandSS()
	got := tt.IRMAA(150000, FilingSingle, 70)
	assert.InDelta(t, 2873, got, 0.01)
}

func TestIRMAA_TopTierWithUnboundedMax(t *testing.T) {
	tt := tablesWithIRMAAandSS()
	got := tt.IRMAA(2_000_000, FilingMFJ, 70)
	assert.InDelta(t, 6935*2, got, 0.01)
}

func TestTaxableSS_NoSSReturnsZero(t *testing.T) {
	tt := tablesWithIRMAAandSS()
	assert.Equal(t, 0.0, tt.TaxableSS(50000, 0, FilingMFJ))
}

func TestTaxableSS_BelowLowerThresholdReturnsZero(t *testing.T) {
	// MFJ lower = $32k. Provisional = 5000 + 0.5*40000 = 25000 < 32000.
	tt := tablesWithIRMAAandSS()
	assert.Equal(t, 0.0, tt.TaxableSS(5000, 40000, FilingMFJ))
}

func TestTaxableSS_70YearOldMFJ_PlanCriterion(t *testing.T) {
	// Plan success criterion 1: 70 MFJ, $40k SS, $30k other -> taxable SS ~= $11k.
	// provisional = 30000 + 0.5*40000 = 50000.
	// MFJ thresholds: lower=32k, upper=44k. provisional > upper.
	// taxable = 0.5*(44-32)k + 0.85*(50-44)k = 6000 + 5100 = 11100.
	tt := tablesWithIRMAAandSS()
	got := tt.TaxableSS(30000, 40000, FilingMFJ)
	assert.InDelta(t, 11100, got, 0.01)
}

func TestTaxableSS_CappedAt85Pct(t *testing.T) {
	// Very high other income; taxable SS must cap at 0.85*ssBenefit.
	tt := tablesWithIRMAAandSS()
	got := tt.TaxableSS(500000, 40000, FilingMFJ)
	assert.InDelta(t, 0.85*40000, got, 0.01)
}

func TestTaxableSS_BetweenThresholdsHalf(t *testing.T) {
	// Single, $20k SS, $20k other. provisional = 20000 + 10000 = 30000.
	// Single thresholds: lower=25k, upper=34k. 25k < 30k <= 34k.
	// taxable = 0.5 * (30000 - 25000) = 2500.
	tt := tablesWithIRMAAandSS()
	got := tt.TaxableSS(20000, 20000, FilingSingle)
	assert.InDelta(t, 2500, got, 0.01)
}

func TestIRMAAStandardTop(t *testing.T) {
	tt := tablesWithIRMAAandSS()
	assert.InDelta(t, 218000, tt.IRMAAStandardTop(FilingMFJ), 0.01)
	assert.InDelta(t, 109000, tt.IRMAAStandardTop(FilingSingle), 0.01)
}

func TestMaxConvAtIRMAAStandardTop_NoSS(t *testing.T) {
	// MFJ standard top = $218k. With $50k other and no SS / RMD, cap = $168k.
	tt := tablesWithIRMAAandSS()
	got := tt.MaxConvAtIRMAAStandardTop(50000, 0, 0, FilingMFJ)
	assert.InDelta(t, 168000, got, 1.0)
}

func TestMaxConvAtIRMAAStandardTop_WithSS_MAGIExactlyAtCap(t *testing.T) {
	// MFJ standard top = $218k. $50k other, $40k SS, no RMD. Solve fixed-point:
	// MAGI = 50k + conv + TaxableSS(50k+conv, 40k, MFJ) = 218k.
	// At provisional > $44k upper, taxable_ss saturates near 0.85*40k = $34k.
	// So conv ~= 218k - 50k - 34k = $134k. Sanity-check via the helper.
	tt := tablesWithIRMAAandSS()
	got := tt.MaxConvAtIRMAAStandardTop(50000, 0, 40000, FilingMFJ)
	// Verify the result lands MAGI at the cap (within $1).
	taxableSS := tt.TaxableSS(50000+got, 40000, FilingMFJ)
	magi := 50000 + got + taxableSS
	assert.InDelta(t, 218000, magi, 1.0)
}

func TestMaxConvAtIRMAAStandardTop_NegativeWhenOtherExceedsCap(t *testing.T) {
	// $250k other income already exceeds the $218k MFJ standard tier. Helper
	// must return 0, not a negative cap.
	tt := tablesWithIRMAAandSS()
	got := tt.MaxConvAtIRMAAStandardTop(250000, 0, 0, FilingMFJ)
	assert.Equal(t, 0.0, got)
}

func TestProjectYear_BackwardCompatWithoutSSorIRMAA(t *testing.T) {
	// With AnnualSSBenefit=0 and age<65, projection should match v1 behavior.
	tt := tablesWithIRMAAandSS()
	tt.OrdinaryBrackets = map[FilingStatus][]Bracket{
		FilingMFJ: {{Rate: 0.10, Max: 24800}, {Rate: 0.12, Max: 100800}, {Rate: 0.37, Max: 0}},
	}
	state := YearState{Trad: 100000, Roth: 0, Age: 60, CalYear: 2026}
	in := YearInputs{
		Tables:      tt,
		Status:      FilingMFJ,
		OtherIncome: 50000,
	}
	year, _ := ProjectYear(state, in, func(YearState, float64) float64 { return 0 })
	// taxable = 50000, after_std = 17,800 -> fed = 1,780.
	assert.InDelta(t, 50000, year.TaxableIncome, 0.01)
	assert.InDelta(t, 1780, year.FederalTax, 0.01)
	assert.InDelta(t, 0, year.IRMAASurcharge, 0.01)
	assert.InDelta(t, 0, year.TaxableSS, 0.01)
}

func TestProjectYear_IRMAAFiresAtAge65WithLookback(t *testing.T) {
	tt := tablesWithIRMAAandSS()
	tt.OrdinaryBrackets = map[FilingStatus][]Bracket{
		FilingMFJ: {{Rate: 0.10, Max: 24800}, {Rate: 0.12, Max: 100800}, {Rate: 0.22, Max: 211400}, {Rate: 0.37, Max: 0}},
	}
	state := YearState{Trad: 100000, Roth: 0, Age: 66, CalYear: 2026}
	in := YearInputs{
		Tables:          tt,
		Status:          FilingMFJ,
		OtherIncome:     50000,
		MAGITwoYearsAgo: 300000, // tier 2 for MFJ
	}
	year, _ := ProjectYear(state, in, func(YearState, float64) float64 { return 0 })
	// Tier 2 per-person = $2,873, household = $5,746.
	assert.InDelta(t, 5746, year.IRMAASurcharge, 0.01)
}

func TestProjectYear_SSImpactsTaxableIncome(t *testing.T) {
	tt := tablesWithIRMAAandSS()
	tt.OrdinaryBrackets = map[FilingStatus][]Bracket{
		FilingMFJ: {{Rate: 0.10, Max: 24800}, {Rate: 0.12, Max: 100800}, {Rate: 0.22, Max: 211400}, {Rate: 0.37, Max: 0}},
	}
	state := YearState{Trad: 100000, Roth: 0, Age: 70, CalYear: 2026}
	in := YearInputs{
		Tables:          tt,
		Status:          FilingMFJ,
		OtherIncome:     30000,
		AnnualSSBenefit: 40000,
	}
	year, _ := ProjectYear(state, in, func(YearState, float64) float64 { return 0 })
	// taxable_ss = 11100 (from earlier test). taxable_income = 30000 + 11100 = 41100.
	assert.InDelta(t, 11100, year.TaxableSS, 0.01)
	assert.InDelta(t, 41100, year.TaxableIncome, 0.01)
}

func TestRespectIRMAAEnabled_DefaultTrue(t *testing.T) {
	r := OptimizeRequest{}
	assert.True(t, r.RespectIRMAAEnabled())
}

func TestRespectIRMAAEnabled_ExplicitFalse(t *testing.T) {
	v := false
	r := OptimizeRequest{RespectIRMAA: &v}
	assert.False(t, r.RespectIRMAAEnabled())
}

func TestRespectIRMAAEnabled_ExplicitTrue(t *testing.T) {
	v := true
	r := OptimizeRequest{RespectIRMAA: &v}
	assert.True(t, r.RespectIRMAAEnabled())
}

