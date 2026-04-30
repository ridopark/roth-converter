package domain

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
	EndingTraditional   float64 `json:"ending_traditional"`
	EndingRoth          float64 `json:"ending_roth"`
	EndingTotal         float64 `json:"ending_total"`
}

type ScenarioSummary struct {
	TotalFederalTax    float64 `json:"total_federal_tax"`
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
