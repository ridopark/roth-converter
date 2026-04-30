package solver

import (
	"errors"
	"math"
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ridopark/roth-converter/backend/internal/domain"
	"github.com/ridopark/roth-converter/backend/internal/ports"
)

type fakeRepo struct {
	tables domain.TaxTables
	err    error
}

func (f fakeRepo) Get(int) (domain.TaxTables, error) {
	if f.err != nil {
		return domain.TaxTables{}, f.err
	}
	return f.tables, nil
}

func tables2026() domain.TaxTables {
	return domain.TaxTables{
		Year: 2026,
		StandardDeduction: map[domain.FilingStatus]float64{
			domain.FilingMFJ:    32200,
			domain.FilingSingle: 16100,
			domain.FilingHoH:    24150,
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
			domain.FilingSingle: {
				{Rate: 0.10, Max: 12400},
				{Rate: 0.12, Max: 50400},
				{Rate: 0.22, Max: 105700},
				{Rate: 0.24, Max: 201775},
				{Rate: 0.32, Max: 256225},
				{Rate: 0.35, Max: 640600},
				{Rate: 0.37, Max: 0},
			},
		},
		RMDDivisors: map[int]float64{
			73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9,
			78: 22.0, 79: 21.1, 80: 20.2,
		},
	}
}

func newMatrix(repo ports.TaxTablesRepo) *Matrix { return New(repo, zerolog.Nop()) }

func TestRMDStartAge(t *testing.T) {
	cases := []struct {
		name      string
		birthYear int
		want      int
	}{
		{"pre-1951 cohort", 1949, 72},
		{"1951 cohort -> 73", 1951, 73},
		{"1959 cohort still 73", 1959, 73},
		{"1960 cohort jumps to 75", 1960, 75},
		{"1965 cohort 75", 1965, 75},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, domain.RMDStartAge(tc.birthYear))
		})
	}
}

func TestOrdinaryTax_MFJ2026(t *testing.T) {
	tt := tables2026()
	cases := []struct {
		name    string
		taxable float64
		want    float64
	}{
		{"zero", 0, 0},
		{"negative clamps to zero", -100, 0},
		{"top of 10%", 24800, 2480},
		{"in 12%", 50000, 24800*0.10 + (50000-24800)*0.12},
		{"top of 12%", 100800, 24800*0.10 + (100800-24800)*0.12},
		{"in 22%", 150000, 24800*0.10 + (100800-24800)*0.12 + (150000-100800)*0.22},
		{"in 37%", 1_000_000,
			24800*0.10 +
				(100800-24800)*0.12 +
				(211400-100800)*0.22 +
				(403550-211400)*0.24 +
				(512450-403550)*0.32 +
				(768700-512450)*0.35 +
				(1_000_000-768700)*0.37},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tt.OrdinaryTax(tc.taxable, domain.FilingMFJ)
			assert.InDelta(t, tc.want, got, 0.01)
		})
	}
}

func TestComputeRMD(t *testing.T) {
	tt := domain.TaxTables{RMDDivisors: map[int]float64{73: 26.5, 100: 6.4}}
	cases := []struct {
		name    string
		age     int
		balance float64
		want    float64
	}{
		{"known age 73", 73, 265000, 10000},
		{"unknown age returns 0", 70, 100000, 0},
		{"clamp above 100 to 100", 105, 64000, 10000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.InDelta(t, tc.want, tt.RMD(tc.balance, tc.age), 0.01)
		})
	}
}

func TestMatrix_CrossProduct(t *testing.T) {
	m := newMatrix(fakeRepo{tables: tables2026()})
	resp, err := m.Compute(domain.MatrixRequest{
		Age:             60,
		BirthYear:       1966,
		Total401k:       1_000_000,
		TraditionalPct:  0.7,
		RothPct:         0.3,
		FilingStatus:    domain.FilingMFJ,
		HorizonYears:    5,
		RatesOfReturn:   []float64{0.05, 0.10, 0.15},
		ConversionCases: []float64{0, 25_000, 50_000, 100_000},
		TaxYear:         2026,
	})
	require.NoError(t, err)
	require.Len(t, resp.Scenarios, 12)
	for _, s := range resp.Scenarios {
		assert.Len(t, s.Years, 5)
	}
}

func TestMatrix_DefaultsApplied(t *testing.T) {
	m := newMatrix(fakeRepo{tables: tables2026()})
	resp, err := m.Compute(domain.MatrixRequest{
		Age:          60,
		BirthYear:    1966,
		Total401k:    500_000,
		FilingStatus: domain.FilingMFJ,
	})
	require.NoError(t, err)
	// 4 default rates x 4 default cases = 16 scenarios, horizon 10.
	assert.Len(t, resp.Scenarios, 16)
	assert.Len(t, resp.Scenarios[0].Years, 10)
	// Default 70/30 split on $500k.
	first := resp.Scenarios[0].Years[0]
	assert.InDelta(t, 350_000, first.StartingTraditional, 0.01)
	assert.InDelta(t, 150_000, first.StartingRoth, 0.01)
}

func TestMatrix_PctIn0To100Form(t *testing.T) {
	m := newMatrix(fakeRepo{tables: tables2026()})
	resp, err := m.Compute(domain.MatrixRequest{
		Age:             60,
		BirthYear:       1966,
		Total401k:       100_000,
		TraditionalPct:  80,
		RothPct:         20,
		FilingStatus:    domain.FilingMFJ,
		HorizonYears:    1,
		RatesOfReturn:   []float64{0},
		ConversionCases: []float64{0},
	})
	require.NoError(t, err)
	first := resp.Scenarios[0].Years[0]
	assert.InDelta(t, 80_000, first.StartingTraditional, 0.01)
	assert.InDelta(t, 20_000, first.StartingRoth, 0.01)
}

func TestMatrix_TotalConservedWhenNoRMD(t *testing.T) {
	// Tax is paid externally, so with no RMD no money leaves the system:
	// ending T+R must equal start * (1+r)^horizon for every conversion case.
	m := newMatrix(fakeRepo{tables: tables2026()})
	const total = 1_000_000.0
	const r = 0.10
	const horizon = 10
	resp, err := m.Compute(domain.MatrixRequest{
		Age:             60,
		BirthYear:       1966,
		Total401k:       total,
		TraditionalPct:  0.7,
		RothPct:         0.3,
		FilingStatus:    domain.FilingMFJ,
		HorizonYears:    horizon,
		RatesOfReturn:   []float64{r},
		ConversionCases: []float64{0, 50_000, 200_000},
	})
	require.NoError(t, err)
	want := total * math.Pow(1+r, horizon)
	for _, s := range resp.Scenarios {
		assert.InDelta(t, want, s.Summary.EndingTotal, 1.0,
			"conv=%.0f", s.ConversionAmount)
	}
}

func TestMatrix_ConversionCappedByTradBalance(t *testing.T) {
	m := newMatrix(fakeRepo{tables: tables2026()})
	resp, err := m.Compute(domain.MatrixRequest{
		Age:             60,
		BirthYear:       1966,
		Total401k:       100_000,
		TraditionalPct:  1.0,
		FilingStatus:    domain.FilingMFJ,
		HorizonYears:    3,
		RatesOfReturn:   []float64{0},
		ConversionCases: []float64{1_000_000},
	})
	require.NoError(t, err)
	s := resp.Scenarios[0]
	assert.InDelta(t, 100_000, s.Summary.TotalConverted, 0.01)
	assert.InDelta(t, 0, s.Summary.EndingTraditional, 0.01)
	assert.InDelta(t, 100_000, s.Summary.EndingRoth, 0.01)
	assert.InDelta(t, 100_000, s.Years[0].Conversion, 0.01)
	assert.InDelta(t, 0, s.Years[1].Conversion, 0.01)
	assert.InDelta(t, 0, s.Years[2].Conversion, 0.01)
}

func TestMatrix_RMDOnlyAtOrAfterStartAge(t *testing.T) {
	// Start age 70, born 1956 -> RMD age 73. Years 0-2 (ages 70-72): RMD=0.
	// Year 3 (age 73): RMD>0 from the divisor table.
	m := newMatrix(fakeRepo{tables: tables2026()})
	resp, err := m.Compute(domain.MatrixRequest{
		Age:             70,
		BirthYear:       1956,
		Total401k:       500_000,
		TraditionalPct:  1.0,
		FilingStatus:    domain.FilingMFJ,
		HorizonYears:    5,
		RatesOfReturn:   []float64{0},
		ConversionCases: []float64{0},
		IncludeRMD:      true,
		TaxYear:         2026,
	})
	require.NoError(t, err)
	years := resp.Scenarios[0].Years
	assert.Equal(t, 0.0, years[0].RMD)
	assert.Equal(t, 0.0, years[1].RMD)
	assert.Equal(t, 0.0, years[2].RMD)
	assert.Greater(t, years[3].RMD, 0.0)
	assert.Greater(t, years[4].RMD, 0.0)
}

func TestMatrix_FederalTaxIsBracketsOnly(t *testing.T) {
	// MFJ, $50k other income, no conv, no RMD. After std deduction $32,200,
	// taxable=$17,800 stays in 10% bracket -> $1,780/yr * 10 yrs = $17,800.
	m := newMatrix(fakeRepo{tables: tables2026()})
	resp, err := m.Compute(domain.MatrixRequest{
		Age:               60,
		BirthYear:         1966,
		Total401k:         100_000,
		TraditionalPct:    1.0,
		FilingStatus:      domain.FilingMFJ,
		AnnualOtherIncome: 50_000,
		HorizonYears:      10,
		RatesOfReturn:     []float64{0},
		ConversionCases:   []float64{0},
	})
	require.NoError(t, err)
	assert.InDelta(t, 17_800, resp.Scenarios[0].Summary.TotalFederalTax, 0.01)
}

func TestMatrix_InvalidInputs(t *testing.T) {
	m := newMatrix(fakeRepo{tables: tables2026()})
	cases := []struct {
		name string
		req  domain.MatrixRequest
	}{
		{"bad filing status", domain.MatrixRequest{Age: 60, FilingStatus: "garbage"}},
		{"negative balance", domain.MatrixRequest{Age: 60, FilingStatus: domain.FilingMFJ, Total401k: -1}},
		{"zero age", domain.MatrixRequest{Age: 0, FilingStatus: domain.FilingMFJ}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := m.Compute(tc.req)
			require.Error(t, err)
		})
	}
}

func TestMatrix_StateTaxApplied(t *testing.T) {
	tt := tables2026()
	tt.StateTaxRates = map[string]float64{"CA": 0.10}
	tt.NoTaxStates = map[string]bool{"TX": true}
	m := newMatrix(fakeRepo{tables: tt})

	// MFJ, $50k other income, no conv, no RMD, 1 yr horizon.
	// taxable = 50k, after_std = 17,800.
	// fed_tax = 1,780. CA state_tax = 17,800 * 0.10 = 1,780.
	cases := []struct {
		name        string
		state       string
		wantRate    float64
		wantStateTx float64
	}{
		{"CA rated", "CA", 0.10, 1780},
		{"TX no_tax", "TX", 0, 0},
		{"empty state", "", 0, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := m.Compute(domain.MatrixRequest{
				Age:               60,
				BirthYear:         1966,
				Total401k:         100_000,
				TraditionalPct:    1.0,
				FilingStatus:      domain.FilingMFJ,
				AnnualOtherIncome: 50_000,
				HorizonYears:      1,
				RatesOfReturn:     []float64{0},
				ConversionCases:   []float64{0},
				State:             tc.state,
			})
			require.NoError(t, err)
			assert.InDelta(t, tc.wantRate, resp.StateTaxRate, 0.0001)
			assert.InDelta(t, tc.wantStateTx, resp.Scenarios[0].Years[0].StateTax, 0.01)
			assert.InDelta(t, tc.wantStateTx, resp.Scenarios[0].Summary.TotalStateTax, 0.01)
		})
	}
}

func TestMatrix_PopulatesBracketsAndStdDeduction(t *testing.T) {
	tt := tables2026()
	m := newMatrix(fakeRepo{tables: tt})
	resp, err := m.Compute(domain.MatrixRequest{
		Age:             60,
		BirthYear:       1966,
		Total401k:       100_000,
		TraditionalPct:  1.0,
		FilingStatus:    domain.FilingMFJ,
		HorizonYears:    1,
		RatesOfReturn:   []float64{0},
		ConversionCases: []float64{0},
	})
	require.NoError(t, err)
	assert.Equal(t, tt.OrdinaryBrackets[domain.FilingMFJ], resp.Brackets)
	assert.InDelta(t, tt.StandardDeduction[domain.FilingMFJ], resp.StandardDeduction, 0.01)

	// Filing-status sensitivity: single returns single's brackets and deduction.
	resp2, err := m.Compute(domain.MatrixRequest{
		Age:             60,
		BirthYear:       1966,
		Total401k:       100_000,
		TraditionalPct:  1.0,
		FilingStatus:    domain.FilingSingle,
		HorizonYears:    1,
		RatesOfReturn:   []float64{0},
		ConversionCases: []float64{0},
	})
	require.NoError(t, err)
	assert.Equal(t, tt.OrdinaryBrackets[domain.FilingSingle], resp2.Brackets)
	assert.InDelta(t, tt.StandardDeduction[domain.FilingSingle], resp2.StandardDeduction, 0.01)
}

func TestMatrix_TaxTableLoadFailure(t *testing.T) {
	m := newMatrix(fakeRepo{err: errors.New("boom")})
	_, err := m.Compute(domain.MatrixRequest{
		Age: 60, FilingStatus: domain.FilingMFJ, Total401k: 100_000,
	})
	require.Error(t, err)
}
