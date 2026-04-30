package solver

import (
	"fmt"

	"github.com/rs/zerolog"

	"github.com/ridopark/roth-converter/backend/internal/domain"
	"github.com/ridopark/roth-converter/backend/internal/ports"
)

type Matrix struct {
	tables ports.TaxTablesRepo
	log    zerolog.Logger
}

func New(tables ports.TaxTablesRepo, log zerolog.Logger) *Matrix {
	return &Matrix{tables: tables, log: log.With().Str("component", "matrix").Logger()}
}

func (m *Matrix) Compute(req domain.MatrixRequest) (domain.MatrixResponse, error) {
	if err := req.Validate(); err != nil {
		return domain.MatrixResponse{}, fmt.Errorf("matrix: %w", err)
	}
	tables, err := m.tables.Get(req.YearOrDefault())
	if err != nil {
		return domain.MatrixResponse{}, fmt.Errorf("matrix: load tables: %w", err)
	}
	r := req.Resolve(tables)

	rates := req.RatesOfReturn
	if len(rates) == 0 {
		rates = []float64{0.10, 0.15, 0.20, 0.25}
	}
	cases := req.ConversionCases
	if len(cases) == 0 {
		cases = []float64{0, 25000, 50000, 100000}
	}

	scenarios := make([]domain.Scenario, 0, len(rates)*len(cases))
	for _, rate := range rates {
		for _, c := range cases {
			scenarios = append(scenarios, projectScenario(rate, c, req.Profile, r, tables))
		}
	}
	return domain.MatrixResponse{
		Scenarios:         scenarios,
		Brackets:          tables.OrdinaryBrackets[req.FilingStatus],
		StandardDeduction: tables.StandardDeduction[req.FilingStatus],
		StateTaxRate:      r.StateRate,
		IRMAATiers:        tables.IRMAATiers[req.FilingStatus],
	}, nil
}

func projectScenario(rate, convCase float64, profile domain.Profile, r domain.Resolved, tables domain.TaxTables) domain.Scenario {
	state := domain.YearState{Trad: r.StartTrad, Roth: r.StartRoth, Age: profile.Age, CalYear: r.Year}
	in := domain.YearInputs{
		Tables:           tables,
		Status:           profile.FilingStatus,
		StateRate:        r.StateRate,
		Rate:             rate,
		IncludeRMD:       profile.IncludeRMD,
		RmdStartAge:      r.RmdStartAge,
		AcaHouseholdSize: profile.AcaHouseholdSize,
		AcaAnnualPremium: profile.AcaAnnualPremium,
	}
	years := make([]domain.ScenarioYear, 0, r.Horizon)
	var sumFedTax, sumStateTax, sumConv, sumRMD, sumIRMAA, sumTaxableSS, sumNIIT, sumACA float64

	// MAGI lookback for IRMAA: year N's surcharge uses MAGI from year N-2.
	// Seed with the profile's recent-history MAGI; once horizon years generate
	// their own MAGI, those values feed the buffer.
	magiPrev2 := profile.MAGITwoYearsAgo
	magiPrev1 := profile.MAGIOneYearAgo

	for i := 0; i < r.Horizon; i++ {
		in.MAGITwoYearsAgo = magiPrev2
		in.OtherIncome = pickPerYear(profile.OtherIncomePerYear, i, profile.AnnualOtherIncome)
		in.AnnualSSBenefit = pickPerYear(profile.SSBenefitPerYear, i, profile.AnnualSSBenefit)
		in.TaxableDivLTCG = pickPerYear(profile.TaxableDivLTCGPerYear, i, profile.TaxableDivLTCG)
		var year domain.ScenarioYear
		year, state = domain.ProjectYear(state, in, func(_ domain.YearState, _ float64) float64 { return convCase })
		year.YearIndex = i + 1
		years = append(years, year)
		sumFedTax += year.FederalTax
		sumStateTax += year.StateTax
		sumConv += year.Conversion
		sumRMD += year.RMD
		sumIRMAA += year.IRMAASurcharge
		sumTaxableSS += year.TaxableSS
		sumNIIT += year.NIIT
		sumACA += year.ACAPenalty
		magiPrev2, magiPrev1 = magiPrev1, year.MAGI
	}

	return domain.Scenario{
		RateOfReturn:     rate,
		ConversionAmount: convCase,
		Years:            years,
		Summary: domain.ScenarioSummary{
			TotalFederalTax:     domain.Round(sumFedTax),
			TotalStateTax:       domain.Round(sumStateTax),
			TotalConverted:      domain.Round(sumConv),
			TotalRMD:            domain.Round(sumRMD),
			EndingTotal:         domain.Round(state.Trad + state.Roth),
			EndingTraditional:   domain.Round(state.Trad),
			EndingRoth:          domain.Round(state.Roth),
			TotalTaxableSS:      domain.Round(sumTaxableSS),
			TotalIRMAASurcharge: domain.Round(sumIRMAA),
			TotalNIIT:           domain.Round(sumNIIT),
			TotalACAPenalty:     domain.Round(sumACA),
		},
	}
}

// pickPerYear returns overrides[index] when overrides has at least index+1
// entries, otherwise the scalar fallback. This is how every per-year-override
// field defaults to the scalar Profile field unless explicitly provided.
func pickPerYear(overrides []float64, index int, fallback float64) float64 {
	if index < len(overrides) {
		return overrides[index]
	}
	return fallback
}
