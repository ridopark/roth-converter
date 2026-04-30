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

	state := domain.YearState{Trad: r.StartTrad, Roth: r.StartRoth, Age: req.Age, CalYear: r.Year}
	in := domain.YearInputs{
		Tables:      tables,
		Status:      req.FilingStatus,
		OtherIncome: req.AnnualOtherIncome,
		StateRate:   r.StateRate,
		Rate:        req.RateOfReturn,
		IncludeRMD:  req.IncludeRMD,
		RmdStartAge: r.RmdStartAge,
	}

	fillToBracket := func(s domain.YearState, rmd float64) float64 {
		baseAfterStd := math.Max(0, req.AnnualOtherIncome+rmd-stdDed)
		return math.Max(0, bracketTop-baseAfterStd)
	}

	years := make([]domain.ScenarioYear, 0, r.Horizon)
	var sumFedTax, sumStateTax, sumConv, sumRMD float64

	for i := 0; i < r.Horizon; i++ {
		var year domain.ScenarioYear
		year, state = domain.ProjectYear(state, in, fillToBracket)
		year.YearIndex = i + 1
		years = append(years, year)
		sumFedTax += year.FederalTax
		sumStateTax += year.StateTax
		sumConv += year.Conversion
		sumRMD += year.RMD
	}

	return domain.OptimizePlan{
		Plan: domain.Scenario{
			RateOfReturn:     req.RateOfReturn,
			ConversionAmount: 0,
			Years:            years,
			Summary: domain.ScenarioSummary{
				TotalFederalTax:   domain.Round(sumFedTax),
				TotalStateTax:     domain.Round(sumStateTax),
				TotalConverted:    domain.Round(sumConv),
				TotalRMD:          domain.Round(sumRMD),
				EndingTotal:       domain.Round(state.Trad + state.Roth),
				EndingTraditional: domain.Round(state.Trad),
				EndingRoth:        domain.Round(state.Roth),
			},
		},
		Brackets:          tables.OrdinaryBrackets[req.FilingStatus],
		StandardDeduction: stdDed,
		StateTaxRate:      r.StateRate,
		TargetBracketRate: req.TargetBracketRate,
		TargetBracketTop:  bracketTop,
	}, nil
}
