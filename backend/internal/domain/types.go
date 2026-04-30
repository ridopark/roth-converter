package domain

import "math"

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

type MatrixRequest struct {
	Age                 int          `json:"age"`
	BirthYear           int          `json:"birth_year"`
	Total401k           float64      `json:"total_401k"`
	TraditionalPct      float64      `json:"traditional_pct"`
	RothPct             float64      `json:"roth_pct"`
	FilingStatus        FilingStatus `json:"filing_status"`
	AnnualOtherIncome   float64      `json:"annual_other_income"`
	HorizonYears        int          `json:"horizon_years"`
	RatesOfReturn       []float64    `json:"rates_of_return"`
	ConversionCases     []float64    `json:"conversion_cases"`
	IncludeRMD          bool         `json:"include_rmd"`
	TaxYear             int          `json:"tax_year"`
	State               string       `json:"state"`
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
	TotalFederalTax    float64 `json:"total_federal_tax"`
	TotalStateTax      float64 `json:"total_state_tax"`
	TotalConverted     float64 `json:"total_converted"`
	TotalRMD           float64 `json:"total_rmd"`
	EndingTotal        float64 `json:"ending_total"`
	EndingTraditional  float64 `json:"ending_traditional"`
	EndingRoth         float64 `json:"ending_roth"`
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
	Age               int          `json:"age"`
	BirthYear         int          `json:"birth_year"`
	Total401k         float64      `json:"total_401k"`
	TraditionalPct    float64      `json:"traditional_pct"`
	RothPct           float64      `json:"roth_pct"`
	FilingStatus      FilingStatus `json:"filing_status"`
	AnnualOtherIncome float64      `json:"annual_other_income"`
	HorizonYears      int          `json:"horizon_years"`
	RateOfReturn      float64      `json:"rate_of_return"`
	TargetBracketRate float64      `json:"target_bracket_rate"`
	IncludeRMD        bool         `json:"include_rmd"`
	TaxYear           int          `json:"tax_year"`
	State             string       `json:"state"`
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
		if math.Abs(b.Rate-targetRate) < 1e-9 {
			return b.Max
		}
	}
	return 0
}

func Round(v float64) float64 {
	return math.Round(v*100) / 100
}
