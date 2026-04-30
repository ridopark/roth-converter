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
	if !req.FilingStatus.Valid() {
		return domain.OptimizePlan{}, fmt.Errorf("optimizer: invalid filing status")
	}
	if req.Total401k < 0 || req.Age <= 0 {
		return domain.OptimizePlan{}, fmt.Errorf("optimizer: invalid age or balance")
	}
	year := req.TaxYear
	if year == 0 {
		year = 2026
	}
	tables, err := o.tables.Get(year)
	if err != nil {
		return domain.OptimizePlan{}, fmt.Errorf("optimizer: load tables: %w", err)
	}
	horizon := req.HorizonYears
	if horizon <= 0 {
		horizon = 10
	}
	tradPct := req.TraditionalPct
	rothPct := req.RothPct
	if tradPct == 0 && rothPct == 0 {
		tradPct, rothPct = 0.70, 0.30
	}
	if tradPct > 1 || rothPct > 1 {
		tradPct = tradPct / 100
		rothPct = rothPct / 100
	}
	startTrad := req.Total401k * tradPct
	startRoth := req.Total401k * rothPct

	birthYear := req.BirthYear
	if birthYear == 0 {
		birthYear = year - req.Age
	}
	rmdStart := domain.RMDStartAge(birthYear)

	bracketTop := tables.BracketTop(req.TargetBracketRate, req.FilingStatus)
	if bracketTop <= 0 {
		return domain.OptimizePlan{}, fmt.Errorf("optimizer: target bracket %.2f not found or has no finite top for filing status %q", req.TargetBracketRate, req.FilingStatus)
	}

	stateRate := tables.StateRate(req.State)
	stdDed := tables.StandardDeduction[req.FilingStatus]

	trad := startTrad
	roth := startRoth
	years := make([]domain.ScenarioYear, 0, horizon)

	var sumFedTax, sumStateTax, sumConv, sumRMD float64

	for i := 0; i < horizon; i++ {
		age := req.Age + i
		calYear := year + i

		var rmd float64
		if req.IncludeRMD && age >= rmdStart && trad > 0 {
			rmd = tables.RMD(trad, age)
		}

		baseTaxable := req.AnnualOtherIncome + rmd
		baseAfterStd := math.Max(0, baseTaxable-stdDed)
		headroom := math.Max(0, bracketTop-baseAfterStd)

		conv := math.Min(headroom, math.Max(0, trad-rmd))

		taxable := baseTaxable + conv
		afterStd := math.Max(0, taxable-stdDed)
		fedTax := tables.OrdinaryTax(afterStd, req.FilingStatus)
		stateTax := afterStd * stateRate

		startingTrad := trad
		startingRoth := roth

		trad = (trad - conv - rmd) * (1 + req.RateOfReturn)
		roth = (roth + conv) * (1 + req.RateOfReturn)
		if trad < 0 {
			trad = 0
		}

		years = append(years, domain.ScenarioYear{
			YearIndex:           i + 1,
			CalendarYear:        calYear,
			Age:                 age,
			StartingTraditional: domain.Round(startingTrad),
			StartingRoth:        domain.Round(startingRoth),
			RMD:                 domain.Round(rmd),
			Conversion:          domain.Round(conv),
			TaxableIncome:       domain.Round(taxable),
			FederalTax:          domain.Round(fedTax),
			StateTax:            domain.Round(stateTax),
			EndingTraditional:   domain.Round(trad),
			EndingRoth:          domain.Round(roth),
			EndingTotal:         domain.Round(trad + roth),
		})

		sumFedTax += fedTax
		sumStateTax += stateTax
		sumConv += conv
		sumRMD += rmd
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
				EndingTotal:       domain.Round(trad + roth),
				EndingTraditional: domain.Round(trad),
				EndingRoth:        domain.Round(roth),
			},
		},
		Brackets:          tables.OrdinaryBrackets[req.FilingStatus],
		StandardDeduction: stdDed,
		StateTaxRate:      stateRate,
		TargetBracketRate: req.TargetBracketRate,
		TargetBracketTop:  bracketTop,
	}, nil
}
