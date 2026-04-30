package solver

import (
	"fmt"
	"math"

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
	if !req.FilingStatus.Valid() {
		return domain.MatrixResponse{}, fmt.Errorf("matrix: invalid filing status")
	}
	if req.Total401k < 0 || req.Age <= 0 {
		return domain.MatrixResponse{}, fmt.Errorf("matrix: invalid age or balance")
	}
	year := req.TaxYear
	if year == 0 {
		year = 2026
	}
	tables, err := m.tables.Get(year)
	if err != nil {
		return domain.MatrixResponse{}, fmt.Errorf("matrix: load tables: %w", err)
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

	rates := req.RatesOfReturn
	if len(rates) == 0 {
		rates = []float64{0.10, 0.15, 0.20, 0.25}
	}
	cases := req.ConversionCases
	if len(cases) == 0 {
		cases = []float64{0, 25000, 50000, 100000}
	}

	stateRate := stateTaxRate(req.State, tables)

	in := projectInputs{
		startTrad:    startTrad,
		startRoth:    startRoth,
		otherIncome:  req.AnnualOtherIncome,
		status:       req.FilingStatus,
		includeRMD:   req.IncludeRMD,
		rmdStartAge:  rmdStart,
		startAge:     req.Age,
		startYear:    year,
		horizon:      horizon,
		tables:       tables,
		stateRate:    stateRate,
	}

	scenarios := make([]domain.Scenario, 0, len(rates)*len(cases))
	for _, r := range rates {
		for _, c := range cases {
			scenarios = append(scenarios, projectScenario(r, c, in))
		}
	}
	return domain.MatrixResponse{
		Scenarios:         scenarios,
		Brackets:          tables.OrdinaryBrackets[req.FilingStatus],
		StandardDeduction: tables.StandardDeduction[req.FilingStatus],
		StateTaxRate:      stateRate,
	}, nil
}

func stateTaxRate(code string, tables domain.TaxTables) float64 {
	if code == "" {
		return 0
	}
	if tables.NoTaxStates[code] {
		return 0
	}
	return tables.StateTaxRates[code]
}

type projectInputs struct {
	startTrad   float64
	startRoth   float64
	otherIncome float64
	status      domain.FilingStatus
	includeRMD  bool
	rmdStartAge int
	startAge    int
	startYear   int
	horizon     int
	tables      domain.TaxTables
	stateRate   float64
}

func projectScenario(rate, convCase float64, in projectInputs) domain.Scenario {
	trad := in.startTrad
	roth := in.startRoth
	years := make([]domain.ScenarioYear, 0, in.horizon)
	stdDed := in.tables.StandardDeduction[in.status]

	var sumFedTax, sumStateTax, sumConv, sumRMD float64

	for i := 0; i < in.horizon; i++ {
		age := in.startAge + i
		calYear := in.startYear + i

		var rmd float64
		if in.includeRMD && age >= in.rmdStartAge && trad > 0 {
			rmd = computeRMD(trad, age, in.tables.RMDDivisors)
		}

		conv := convCase
		if conv > trad-rmd {
			conv = trad - rmd
		}
		if conv < 0 {
			conv = 0
		}

		taxable := in.otherIncome + conv + rmd
		afterStd := taxable - stdDed
		if afterStd < 0 {
			afterStd = 0
		}
		fedTax := ordinaryTax(afterStd, in.status, in.tables)
		stateTax := afterStd * in.stateRate

		startingTrad := trad
		startingRoth := roth

		trad = (trad - conv - rmd) * (1 + rate)
		roth = (roth + conv) * (1 + rate)
		if trad < 0 {
			trad = 0
		}

		years = append(years, domain.ScenarioYear{
			YearIndex:           i + 1,
			CalendarYear:        calYear,
			Age:                 age,
			StartingTraditional: round(startingTrad),
			StartingRoth:        round(startingRoth),
			RMD:                 round(rmd),
			Conversion:          round(conv),
			TaxableIncome:       round(taxable),
			FederalTax:          round(fedTax),
			StateTax:            round(stateTax),
			EndingTraditional:   round(trad),
			EndingRoth:          round(roth),
			EndingTotal:         round(trad + roth),
		})

		sumFedTax += fedTax
		sumStateTax += stateTax
		sumConv += conv
		sumRMD += rmd
	}

	return domain.Scenario{
		RateOfReturn:     rate,
		ConversionAmount: convCase,
		Years:            years,
		Summary: domain.ScenarioSummary{
			TotalFederalTax:   round(sumFedTax),
			TotalStateTax:     round(sumStateTax),
			TotalConverted:    round(sumConv),
			TotalRMD:          round(sumRMD),
			EndingTotal:       round(trad + roth),
			EndingTraditional: round(trad),
			EndingRoth:        round(roth),
		},
	}
}

func computeRMD(balance float64, age int, divisors map[int]float64) float64 {
	if age > 100 {
		age = 100
	}
	d, ok := divisors[age]
	if !ok || d == 0 {
		return 0
	}
	return balance / d
}

func ordinaryTax(taxable float64, status domain.FilingStatus, t domain.TaxTables) float64 {
	if taxable <= 0 {
		return 0
	}
	bs := t.OrdinaryBrackets[status]
	var tax, prev float64
	for _, b := range bs {
		max := b.Max
		if max == 0 {
			max = math.Inf(1)
		}
		if taxable <= max {
			tax += (taxable - prev) * b.Rate
			return tax
		}
		tax += (max - prev) * b.Rate
		prev = max
	}
	return tax
}

func round(v float64) float64 {
	return math.Round(v*100) / 100
}
