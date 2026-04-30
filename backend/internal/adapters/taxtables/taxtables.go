package taxtables

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/ridopark/roth-converter/backend/internal/domain"
)

type Repo struct {
	dir   string
	cache map[int]domain.TaxTables
}

func New(dir string) *Repo {
	return &Repo{dir: dir, cache: map[int]domain.TaxTables{}}
}

func (r *Repo) Get(year int) (domain.TaxTables, error) {
	if t, ok := r.cache[year]; ok {
		return t, nil
	}
	t, err := r.load(year)
	if err != nil {
		return domain.TaxTables{}, err
	}
	r.cache[year] = t
	return t, nil
}

type rawBracket struct {
	Rate float64  `json:"rate"`
	Max  *float64 `json:"max"`
}

type rawTables struct {
	Year                    int                        `json:"year"`
	StandardDeduction       map[string]any             `json:"standard_deduction"`
	OrdinaryBrackets        map[string][]rawBracket    `json:"ordinary_brackets"`
	RMDDivisors             map[string]float64         `json:"rmd_uniform_lifetime_divisors"`
	States                  *rawStates                 `json:"states"`
	IRMAATiers              map[string][]rawIRMAATier  `json:"irmaa_tiers"`
	SSProvisionalThresholds map[string]rawSSThreshold  `json:"ss_provisional_thresholds"`
}

type rawStates struct {
	NoTax                       []string           `json:"no_tax"`
	ApproximateTopMarginalRate  map[string]float64 `json:"approximate_top_marginal_rate"`
}

type rawIRMAATier struct {
	Label                    string   `json:"label"`
	MaxMAGI                  *float64 `json:"max_magi"`
	AnnualSurchargePerPerson float64  `json:"annual_surcharge_per_person"`
}

type rawSSThreshold struct {
	Lower float64 `json:"lower"`
	Upper float64 `json:"upper"`
}

func (r *Repo) load(year int) (domain.TaxTables, error) {
	path := filepath.Join(r.dir, fmt.Sprintf("tax-tables-%d.json", year))
	bs, err := os.ReadFile(path)
	if err != nil {
		return domain.TaxTables{}, fmt.Errorf("taxtables: read %s: %w", path, err)
	}
	var raw rawTables
	if err := json.Unmarshal(bs, &raw); err != nil {
		return domain.TaxTables{}, fmt.Errorf("taxtables: parse %s: %w", path, err)
	}

	out := domain.TaxTables{
		Year:              raw.Year,
		StandardDeduction: map[domain.FilingStatus]float64{},
		OrdinaryBrackets:  map[domain.FilingStatus][]domain.Bracket{},
		RMDDivisors:       map[int]float64{},
		StateTaxRates:     map[string]float64{},
		NoTaxStates:       map[string]bool{},
		IRMAATiers:        map[domain.FilingStatus][]domain.IRMAATier{},
		SSThresholds:      map[domain.FilingStatus]domain.SSThreshold{},
	}

	if raw.States != nil {
		for _, code := range raw.States.NoTax {
			out.NoTaxStates[code] = true
		}
		for code, rate := range raw.States.ApproximateTopMarginalRate {
			out.StateTaxRates[code] = rate
		}
	}

	for k, v := range raw.StandardDeduction {
		if f, ok := v.(float64); ok {
			out.StandardDeduction[domain.FilingStatus(k)] = f
		}
	}

	for status, bs := range raw.OrdinaryBrackets {
		bracks := make([]domain.Bracket, 0, len(bs))
		for _, b := range bs {
			max := 0.0
			if b.Max != nil {
				max = *b.Max
			}
			bracks = append(bracks, domain.Bracket{Rate: b.Rate, Max: max})
		}
		out.OrdinaryBrackets[domain.FilingStatus(status)] = bracks
	}

	for k, v := range raw.RMDDivisors {
		if age, err := strconv.Atoi(k); err == nil {
			out.RMDDivisors[age] = v
		}
	}

	for status, tiers := range raw.IRMAATiers {
		converted := make([]domain.IRMAATier, 0, len(tiers))
		for _, tier := range tiers {
			max := 0.0
			if tier.MaxMAGI != nil {
				max = *tier.MaxMAGI
			}
			converted = append(converted, domain.IRMAATier{
				Label:                    tier.Label,
				MaxMAGI:                  max,
				AnnualSurchargePerPerson: tier.AnnualSurchargePerPerson,
			})
		}
		out.IRMAATiers[domain.FilingStatus(status)] = converted
	}

	for status, t := range raw.SSProvisionalThresholds {
		out.SSThresholds[domain.FilingStatus(status)] = domain.SSThreshold{Lower: t.Lower, Upper: t.Upper}
	}

	return out, nil
}
