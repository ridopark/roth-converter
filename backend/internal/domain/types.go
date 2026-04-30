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
	AnnualSSBenefit   float64      `json:"annual_ss_benefit,omitempty"`
	MAGITwoYearsAgo   float64      `json:"magi_two_years_ago,omitempty"`
	MAGIOneYearAgo    float64      `json:"magi_one_year_ago,omitempty"`
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
	TaxableSS           float64 `json:"taxable_ss,omitempty"`
	IRMAASurcharge      float64 `json:"irmaa_surcharge,omitempty"`
	MAGI                float64 `json:"magi,omitempty"`
	IRMAATierLabel      string  `json:"irmaa_tier_label,omitempty"`
}

type ScenarioSummary struct {
	TotalFederalTax     float64 `json:"total_federal_tax"`
	TotalStateTax       float64 `json:"total_state_tax"`
	TotalConverted      float64 `json:"total_converted"`
	TotalRMD            float64 `json:"total_rmd"`
	EndingTotal         float64 `json:"ending_total"`
	EndingTraditional   float64 `json:"ending_traditional"`
	EndingRoth          float64 `json:"ending_roth"`
	TotalTaxableSS      float64 `json:"total_taxable_ss,omitempty"`
	TotalIRMAASurcharge float64 `json:"total_irmaa_surcharge,omitempty"`
}

type Scenario struct {
	RateOfReturn     float64         `json:"rate_of_return"`
	ConversionAmount float64         `json:"conversion_amount"`
	Years            []ScenarioYear  `json:"years"`
	Summary          ScenarioSummary `json:"summary"`
}

type MatrixResponse struct {
	Scenarios         []Scenario              `json:"scenarios"`
	Brackets          []Bracket               `json:"brackets"`
	StandardDeduction float64                 `json:"standard_deduction"`
	StateTaxRate      float64                 `json:"state_tax_rate"`
	IRMAATiers        []IRMAATier             `json:"irmaa_tiers,omitempty"`
}

type OptimizeRequest struct {
	Profile
	RateOfReturn      float64 `json:"rate_of_return"`
	TargetBracketRate float64 `json:"target_bracket_rate"`
	RespectIRMAA      *bool   `json:"respect_irmaa,omitempty"`
}

func (r OptimizeRequest) RespectIRMAAEnabled() bool {
	if r.RespectIRMAA == nil {
		return true
	}
	return *r.RespectIRMAA
}

type OptimizePlan struct {
	Plan              Scenario    `json:"plan"`
	Brackets          []Bracket   `json:"brackets"`
	StandardDeduction float64     `json:"standard_deduction"`
	StateTaxRate      float64     `json:"state_tax_rate"`
	TargetBracketRate float64     `json:"target_bracket_rate"`
	TargetBracketTop  float64     `json:"target_bracket_top"`
	IRMAATiers        []IRMAATier `json:"irmaa_tiers,omitempty"`
	RespectIRMAA      bool        `json:"respect_irmaa"`
}

type Bracket struct {
	Rate float64 `json:"rate"`
	Max  float64 `json:"max"`
}

type IRMAATier struct {
	Label                    string  `json:"label"`
	MaxMAGI                  float64 `json:"max_magi"`
	AnnualSurchargePerPerson float64 `json:"annual_surcharge_per_person"`
}

type SSThreshold struct {
	Lower float64 `json:"lower"`
	Upper float64 `json:"upper"`
}

type TaxTables struct {
	Year              int
	StandardDeduction map[FilingStatus]float64
	OrdinaryBrackets  map[FilingStatus][]Bracket
	RMDDivisors       map[int]float64
	StateTaxRates     map[string]float64
	NoTaxStates       map[string]bool
	IRMAATiers        map[FilingStatus][]IRMAATier
	SSThresholds      map[FilingStatus]SSThreshold
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

// IRMAATierFor returns the IRMAA tier the household falls into for a given
// MAGI, plus an empty IRMAATier if no tier table exists. The match rule:
// the first tier whose MaxMAGI >= magi (MaxMAGI == 0 is treated as +inf,
// the unbounded top tier).
func (t TaxTables) IRMAATierFor(magi float64, status FilingStatus) IRMAATier {
	for _, tier := range t.IRMAATiers[status] {
		max := tier.MaxMAGI
		if max == 0 {
			max = math.Inf(1)
		}
		if magi <= max {
			return tier
		}
	}
	return IRMAATier{}
}

// IRMAA returns the household Medicare Part B+D surcharge for the year given
// the Modified AGI of two years prior, the filing status, and the user's age
// in the year the surcharge would apply. Returns 0 when age < 65 (not yet on
// Medicare) or when MAGI is within the standard tier. For MFJ the surcharge
// is doubled (both spouses on Medicare); single filers pay one premium.
func (t TaxTables) IRMAA(magiTwoYearsAgo float64, status FilingStatus, age int) float64 {
	if age < 65 {
		return 0
	}
	perPerson := t.IRMAATierFor(magiTwoYearsAgo, status).AnnualSurchargePerPerson
	if status == FilingMFJ {
		return perPerson * 2
	}
	return perPerson
}

// IRMAAStandardTop returns the upper bound of the standard (zero-surcharge)
// IRMAA tier for the given filing status. Returns 0 if no tiers are loaded.
// The optimizer uses this as a soft cap to keep MAGI below the first surcharge.
func (t TaxTables) IRMAAStandardTop(status FilingStatus) float64 {
	for _, tier := range t.IRMAATiers[status] {
		if tier.AnnualSurchargePerPerson == 0 {
			return tier.MaxMAGI
		}
	}
	return 0
}

// MaxConvAtIRMAAStandardTop returns the largest conversion that keeps MAGI at
// or below the standard IRMAA tier (zero surcharge two years later) given the
// user's other ordinary income, RMD, and SS benefit. Returns 0 if no IRMAA
// tier table is loaded for the status.
func (t TaxTables) MaxConvAtIRMAAStandardTop(otherIncome, rmd, ssBenefit float64, status FilingStatus) float64 {
	top := t.IRMAAStandardTop(status)
	if top <= 0 {
		return 0
	}
	ssAtCap := t.TaxableSS(top-rmd, ssBenefit, status)
	cap := top - otherIncome - rmd - ssAtCap
	if cap < 0 {
		return 0
	}
	return cap
}

// TaxableSS returns the portion of Social Security benefits subject to
// federal income tax under IRC section 86. Provisional income is
// other_income + 0.5 * ss_benefit (AGI-excluding-SS plus tax-exempt interest,
// neither of which we model further). The taxable amount is bounded above by
// 85% of the benefit.
func (t TaxTables) TaxableSS(otherIncome, ssBenefit float64, status FilingStatus) float64 {
	if ssBenefit <= 0 {
		return 0
	}
	thr, ok := t.SSThresholds[status]
	if !ok {
		return 0
	}
	provisional := otherIncome + 0.5*ssBenefit
	if provisional <= thr.Lower {
		return 0
	}
	cap := 0.85 * ssBenefit
	if provisional <= thr.Upper {
		taxable := 0.5 * (provisional - thr.Lower)
		if taxable > 0.5*ssBenefit {
			taxable = 0.5 * ssBenefit
		}
		if taxable > cap {
			taxable = cap
		}
		return taxable
	}
	taxable := 0.5*(thr.Upper-thr.Lower) + 0.85*(provisional-thr.Upper)
	if taxable > cap {
		taxable = cap
	}
	return taxable
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
	Tables          TaxTables
	Status          FilingStatus
	OtherIncome     float64
	StateRate       float64
	Rate            float64
	IncludeRMD      bool
	RmdStartAge     int
	AnnualSSBenefit float64
	// MAGITwoYearsAgo is the Modified AGI from the year that determines the
	// IRMAA surcharge applied this year (Medicare uses a 2-year lookback).
	// Pass 0 when no history is available; surcharge will then be 0 for tiers
	// that depend on that history (years 0 and 1 of a horizon, typically).
	MAGITwoYearsAgo float64
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

	taxableSS := in.Tables.TaxableSS(in.OtherIncome+conv+rmd, in.AnnualSSBenefit, in.Status)
	stdDed := in.Tables.StandardDeduction[in.Status]
	// MAGI ~= AGI for this calculator (we don't model tax-exempt interest), so
	// taxable_income (pre-deduction, post-SS) doubles as the IRMAA MAGI value.
	magi := in.OtherIncome + conv + rmd + taxableSS
	taxable := magi
	afterStd := taxable - stdDed
	if afterStd < 0 {
		afterStd = 0
	}
	fedTax := in.Tables.OrdinaryTax(afterStd, in.Status)
	stateTax := afterStd * in.StateRate
	irmaa := in.Tables.IRMAA(in.MAGITwoYearsAgo, in.Status, state.Age)
	var irmaaTier string
	if state.Age >= 65 {
		irmaaTier = in.Tables.IRMAATierFor(in.MAGITwoYearsAgo, in.Status).Label
	}

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
		TaxableSS:           Round(taxableSS),
		IRMAASurcharge:      Round(irmaa),
		MAGI:                Round(magi),
		IRMAATierLabel:      irmaaTier,
	}
	return year, YearState{Trad: nextTrad, Roth: nextRoth, Age: state.Age + 1, CalYear: state.CalYear + 1}
}
