package domain

import (
	"errors"
	"math"
)

const bracketRateEps = 1e-9

type FilingStatus string

const (
	FilingSingle FilingStatus = "single"
	FilingMFJ    FilingStatus = "mfj"
	FilingHoH    FilingStatus = "hoh"
	FilingMFS    FilingStatus = "mfs"
)

func (f FilingStatus) Valid() bool {
	switch f {
	case FilingSingle, FilingMFJ, FilingHoH, FilingMFS:
		return true
	}
	return false
}

type Profile struct {
	Age               int          `json:"age"`
	BirthYear         int          `json:"birth_year"`
	Total401k         float64      `json:"total_401k"`
	TraditionalPct    float64      `json:"traditional_pct"`
	RothPct           float64      `json:"roth_pct"`
	FilingStatus      FilingStatus `json:"filing_status"`
	AnnualOtherIncome float64      `json:"annual_other_income"`
	HorizonYears      int          `json:"horizon_years"`
	IncludeRMD        bool         `json:"include_rmd"`
	TaxYear           int          `json:"tax_year"`
	State             string       `json:"state"`
}

type Resolved struct {
	StartTrad   float64
	StartRoth   float64
	Year        int
	Horizon     int
	RmdStartAge int
	StateRate   float64
}

func (p Profile) Validate() error {
	if !p.FilingStatus.Valid() {
		return errors.New("invalid filing status")
	}
	if p.Total401k < 0 || p.Age <= 0 {
		return errors.New("invalid age or balance")
	}
	return nil
}

func (p Profile) YearOrDefault() int {
	if p.TaxYear == 0 {
		return 2026
	}
	return p.TaxYear
}

func (p Profile) Resolve(t TaxTables) Resolved {
	year := p.YearOrDefault()
	horizon := p.HorizonYears
	if horizon <= 0 {
		horizon = 10
	}
	tradPct, rothPct := p.TraditionalPct, p.RothPct
	if tradPct == 0 && rothPct == 0 {
		tradPct, rothPct = 0.70, 0.30
	}
	if tradPct > 1 || rothPct > 1 {
		tradPct = tradPct / 100
		rothPct = rothPct / 100
	}
	birthYear := p.BirthYear
	if birthYear == 0 {
		birthYear = year - p.Age
	}
	return Resolved{
		StartTrad:   p.Total401k * tradPct,
		StartRoth:   p.Total401k * rothPct,
		Year:        year,
		Horizon:     horizon,
		RmdStartAge: RMDStartAge(birthYear),
		StateRate:   t.StateRate(p.State),
	}
}

type MatrixRequest struct {
	Profile
	RatesOfReturn   []float64 `json:"rates_of_return"`
	ConversionCases []float64 `json:"conversion_cases"`
}

type ScenarioYear struct {
	YearIndex           int     `json:"year_index"`
	CalendarYear        int     `json:"calendar_year"`
	Age                 int     `json:"age"`
	StartingTraditional float64 `json:"starting_traditional"`
	StartingRoth        float64 `json:"starting_roth"`
	RMD                 float64 `json:"rmd"`
	Conversion          float64 `json:"conversion"`
	TaxableIncome       float64 `json:"taxable_income"`
	FederalTax          float64 `json:"federal_tax"`
	StateTax            float64 `json:"state_tax"`
	EndingTraditional   float64 `json:"ending_traditional"`
	EndingRoth          float64 `json:"ending_roth"`
	EndingTotal         float64 `json:"ending_total"`
}

type ScenarioSummary struct {
	TotalFederalTax   float64 `json:"total_federal_tax"`
	TotalStateTax     float64 `json:"total_state_tax"`
	TotalConverted    float64 `json:"total_converted"`
	TotalRMD          float64 `json:"total_rmd"`
	EndingTotal       float64 `json:"ending_total"`
	EndingTraditional float64 `json:"ending_traditional"`
	EndingRoth        float64 `json:"ending_roth"`
}

type Scenario struct {
	RateOfReturn     float64         `json:"rate_of_return"`
	ConversionAmount float64         `json:"conversion_amount"`
	Years            []ScenarioYear  `json:"years"`
	Summary          ScenarioSummary `json:"summary"`
}

type MatrixResponse struct {
	Scenarios         []Scenario `json:"scenarios"`
	Brackets          []Bracket  `json:"brackets"`
	StandardDeduction float64    `json:"standard_deduction"`
	StateTaxRate      float64    `json:"state_tax_rate"`
}

type OptimizeRequest struct {
	Profile
	RateOfReturn      float64 `json:"rate_of_return"`
	TargetBracketRate float64 `json:"target_bracket_rate"`
}

type OptimizePlan struct {
	Plan              Scenario  `json:"plan"`
	Brackets          []Bracket `json:"brackets"`
	StandardDeduction float64   `json:"standard_deduction"`
	StateTaxRate      float64   `json:"state_tax_rate"`
	TargetBracketRate float64   `json:"target_bracket_rate"`
	TargetBracketTop  float64   `json:"target_bracket_top"`
}

type Bracket struct {
	Rate float64 `json:"rate"`
	Max  float64 `json:"max"`
}

type TaxTables struct {
	Year              int
	StandardDeduction map[FilingStatus]float64
	OrdinaryBrackets  map[FilingStatus][]Bracket
	RMDDivisors       map[int]float64
	StateTaxRates     map[string]float64
	NoTaxStates       map[string]bool
}

func RMDStartAge(birthYear int) int {
	switch {
	case birthYear < 1951:
		return 72
	case birthYear < 1960:
		return 73
	default:
		return 75
	}
}

func (t TaxTables) StateRate(code string) float64 {
	if code == "" || t.NoTaxStates[code] {
		return 0
	}
	return t.StateTaxRates[code]
}

func (t TaxTables) RMD(balance float64, age int) float64 {
	if age > 100 {
		age = 100
	}
	d, ok := t.RMDDivisors[age]
	if !ok || d == 0 {
		return 0
	}
	return balance / d
}

func (t TaxTables) OrdinaryTax(taxable float64, status FilingStatus) float64 {
	if taxable <= 0 {
		return 0
	}
	var tax, prev float64
	for _, b := range t.OrdinaryBrackets[status] {
		max := b.Max
		if max == 0 {
			max = math.Inf(1)
		}
		if taxable <= max {
			return tax + (taxable-prev)*b.Rate
		}
		tax += (max - prev) * b.Rate
		prev = max
	}
	return tax
}

func (t TaxTables) BracketTop(targetRate float64, status FilingStatus) float64 {
	for _, b := range t.OrdinaryBrackets[status] {
		if math.Abs(b.Rate-targetRate) < bracketRateEps {
			return b.Max
		}
	}
	return 0
}

func Round(v float64) float64 {
	return math.Round(v*100) / 100
}

type YearState struct {
	Trad    float64
	Roth    float64
	Age     int
	CalYear int
}

type YearInputs struct {
	Tables      TaxTables
	Status      FilingStatus
	OtherIncome float64
	StateRate   float64
	Rate        float64
	IncludeRMD  bool
	RmdStartAge int
}

func ProjectYear(state YearState, in YearInputs, computeConv func(state YearState, rmd float64) float64) (ScenarioYear, YearState) {
	var rmd float64
	if in.IncludeRMD && state.Age >= in.RmdStartAge && state.Trad > 0 {
		rmd = in.Tables.RMD(state.Trad, state.Age)
	}

	conv := computeConv(state, rmd)
	if conv > state.Trad-rmd {
		conv = state.Trad - rmd
	}
	if conv < 0 {
		conv = 0
	}

	stdDed := in.Tables.StandardDeduction[in.Status]
	taxable := in.OtherIncome + conv + rmd
	afterStd := taxable - stdDed
	if afterStd < 0 {
		afterStd = 0
	}
	fedTax := in.Tables.OrdinaryTax(afterStd, in.Status)
	stateTax := afterStd * in.StateRate

	startingTrad, startingRoth := state.Trad, state.Roth

	nextTrad := (state.Trad - conv - rmd) * (1 + in.Rate)
	nextRoth := (state.Roth + conv) * (1 + in.Rate)
	if nextTrad < 0 {
		nextTrad = 0
	}

	year := ScenarioYear{
		CalendarYear:        state.CalYear,
		Age:                 state.Age,
		StartingTraditional: Round(startingTrad),
		StartingRoth:        Round(startingRoth),
		RMD:                 Round(rmd),
		Conversion:          Round(conv),
		TaxableIncome:       Round(taxable),
		FederalTax:          Round(fedTax),
		StateTax:            Round(stateTax),
		EndingTraditional:   Round(nextTrad),
		EndingRoth:          Round(nextRoth),
		EndingTotal:         Round(nextTrad + nextRoth),
	}
	return year, YearState{Trad: nextTrad, Roth: nextRoth, Age: state.Age + 1, CalYear: state.CalYear + 1}
}
