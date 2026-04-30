package optimizer

import (
	"fmt"
	"math"

	"github.com/rs/zerolog"

	"github.com/ridopark/roth-converter/backend/internal/domain"
	"github.com/ridopark/roth-converter/backend/internal/ports"
)

type BracketFill struct {
	tables ports.TaxTablesRepo
	log    zerolog.Logger
}

func New(tables ports.TaxTablesRepo, log zerolog.Logger) *BracketFill {
	return &BracketFill{tables: tables, log: log.With().Str("component", "optimizer").Logger()}
}

func (o *BracketFill) Solve(req domain.OptimizeRequest) (domain.OptimizePlan, error) {
	if err := req.Validate(); err != nil {
		return domain.OptimizePlan{}, fmt.Errorf("optimizer: %w", err)
	}
	tables, err := o.tables.Get(req.YearOrDefault())
	if err != nil {
		return domain.OptimizePlan{}, fmt.Errorf("optimizer: load tables: %w", err)
	}

	bracketTop := tables.BracketTop(req.TargetBracketRate, req.FilingStatus)
	if bracketTop <= 0 {
		return domain.OptimizePlan{}, fmt.Errorf("optimizer: target bracket %.2f not found or has no finite top for filing status %q", req.TargetBracketRate, req.FilingStatus)
	}

	r := req.Resolve(tables)
	stdDed := tables.StandardDeduction[req.FilingStatus]
	respectIRMAA := req.RespectIRMAAEnabled()

	state := domain.YearState{Trad: r.StartTrad, Roth: r.StartRoth, Age: req.Age, CalYear: r.Year}
	in := domain.YearInputs{
		Tables:          tables,
		Status:          req.FilingStatus,
		OtherIncome:     req.AnnualOtherIncome,
		StateRate:       r.StateRate,
		Rate:            req.RateOfReturn,
		IncludeRMD:      req.IncludeRMD,
		RmdStartAge:     r.RmdStartAge,
		AnnualSSBenefit: req.AnnualSSBenefit,
	}

	fillToBracket := func(s domain.YearState, rmd float64) float64 {
		// Solve conv such that taxable_income == stdDed + bracketTop. Taxable
		// SS depends on (other+conv+rmd), so iterate to convergence (TaxableSS
		// is Lipschitz <= 0.85 in its provisional argument).
		conv := math.Max(0, bracketTop-math.Max(0, req.AnnualOtherIncome+rmd-stdDed))
		for i := 0; i < 8; i++ {
			ss := tables.TaxableSS(req.AnnualOtherIncome+conv+rmd, req.AnnualSSBenefit, req.FilingStatus)
			next := math.Max(0, bracketTop-math.Max(0, req.AnnualOtherIncome+rmd+ss-stdDed))
			if math.Abs(next-conv) < 0.5 {
				conv = next
				break
			}
			conv = next
		}

		// At age >= 63, this year's MAGI seeds a Medicare surcharge two years
		// out. Cap conversion at the standard tier so the surcharge stays $0.
		if respectIRMAA && s.Age >= 63 && conv > 0 {
			capByIRMAA := tables.MaxConvAtIRMAAStandardTop(req.AnnualOtherIncome, rmd, req.AnnualSSBenefit, req.FilingStatus)
			if capByIRMAA > 0 && conv > capByIRMAA {
				conv = capByIRMAA
			}
		}
		return conv
	}

	years := make([]domain.ScenarioYear, 0, r.Horizon)
	var sumFedTax, sumStateTax, sumConv, sumRMD, sumIRMAA, sumTaxableSS float64

	magiPrev2 := req.MAGITwoYearsAgo
	magiPrev1 := req.MAGIOneYearAgo

	for i := 0; i < r.Horizon; i++ {
		in.MAGITwoYearsAgo = magiPrev2
		var year domain.ScenarioYear
		year, state = domain.ProjectYear(state, in, fillToBracket)
		year.YearIndex = i + 1
		years = append(years, year)
		sumFedTax += year.FederalTax
		sumStateTax += year.StateTax
		sumConv += year.Conversion
		sumRMD += year.RMD
		sumIRMAA += year.IRMAASurcharge
		sumTaxableSS += year.TaxableSS
		magiPrev2, magiPrev1 = magiPrev1, year.MAGI
	}

	return domain.OptimizePlan{
		Plan: domain.Scenario{
			RateOfReturn:     req.RateOfReturn,
			ConversionAmount: 0,
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
			},
		},
		Brackets:          tables.OrdinaryBrackets[req.FilingStatus],
		StandardDeduction: stdDed,
		StateTaxRate:      r.StateRate,
		TargetBracketRate: req.TargetBracketRate,
		TargetBracketTop:  bracketTop,
		IRMAATiers:        tables.IRMAATiers[req.FilingStatus],
		RespectIRMAA:      respectIRMAA,
	}, nil
}
