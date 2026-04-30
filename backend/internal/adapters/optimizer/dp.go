package optimizer

import (
	"fmt"
	"math"

	"github.com/rs/zerolog"

	"github.com/ridopark/roth-converter/backend/internal/domain"
	"github.com/ridopark/roth-converter/backend/internal/ports"
)

// DP is a multi-year backward-induction Roth-conversion optimizer. State is
// (year_index, traditional_balance_bucket, magi_prev1_tier_index,
// magi_prev2_tier_index). Action is conversion amount in $5k buckets. Cost is
// federal_tax + state_tax + IRMAA + NIIT + ACA penalty per year, plus a
// terminal lump-sum cost on the remaining Traditional balance.
type DP struct {
	tables ports.TaxTablesRepo
	log    zerolog.Logger
}

func NewDP(tables ports.TaxTablesRepo, log zerolog.Logger) *DP {
	return &DP{tables: tables, log: log.With().Str("component", "dp").Logger()}
}

const (
	dpSmallStep    = 5000.0
	dpBigStep      = 10000.0
	dpBigThreshold = 1_000_000.0
	dpConvStep     = 5000.0
	dpSentinelTier = int8(-1)
)

type dpStateKey struct {
	yearIdx    int16
	tradBucket int32
	magiPrev1  int8
	magiPrev2  int8
}

type dpStepCache struct {
	coreCost   float64 // fed + state + niit + aca (everything except IRMAA)
	currentMAGI float64
	currentTier int8
	nextBucket int32
}

type dpYearVals struct {
	rate, otherIncome, ssBenefit, ltcg float64
	age                                int
}

func (d *DP) Solve(req domain.OptimizeRequest) (domain.OptimizePlan, error) {
	if err := req.Validate(); err != nil {
		return domain.OptimizePlan{}, fmt.Errorf("dp: %w", err)
	}
	tables, err := d.tables.Get(req.YearOrDefault())
	if err != nil {
		return domain.OptimizePlan{}, fmt.Errorf("dp: load tables: %w", err)
	}

	r := req.Resolve(tables)
	stdDed := tables.StandardDeduction[req.FilingStatus]
	horizon := r.Horizon
	tiers := tables.IRMAATiers[req.FilingStatus]

	// Trad-balance grid (start-of-year balance, fixed dollar buckets).
	step := dpSmallStep
	if r.StartTrad > dpBigThreshold {
		step = dpBigStep
	}
	maxTrad := r.StartTrad * 2
	if maxTrad < 1 {
		maxTrad = 1
	}
	nBuckets := int(math.Ceil(maxTrad/step)) + 1

	snap := func(trad float64) int32 {
		if trad <= 0 {
			return 0
		}
		if trad >= maxTrad {
			return int32(nBuckets - 1)
		}
		return int32(math.RoundToEven(trad / step))
	}
	bucketDollars := func(b int32) float64 { return float64(b) * step }

	// Map a MAGI to its IRMAA tier index (or sentinel when no tier table).
	tierIdx := func(magi float64) int8 {
		if len(tiers) == 0 {
			return dpSentinelTier
		}
		if magi <= 0 {
			return 0
		}
		for i, t := range tiers {
			max := t.MaxMAGI
			if max == 0 || magi <= max {
				return int8(i)
			}
		}
		return int8(len(tiers) - 1)
	}
	// Inverse: a representative MAGI for a given tier index. ProjectYear's
	// IRMAA helper consumes prior MAGI only through tier classification, so
	// any value within the tier produces the same surcharge.
	tierCenter := func(idx int8) float64 {
		if idx < 0 || int(idx) >= len(tiers) {
			return 0
		}
		if int(idx) == 0 {
			return 0
		}
		prev := tiers[idx-1].MaxMAGI
		this := tiers[idx].MaxMAGI
		if this == 0 {
			return prev + 1
		}
		return (prev + this) / 2
	}

	// Per-year pre-computed inputs (flatten the per-year-overrides plumbing
	// once so the DP inner loop is a tight pull).
	perYear := make([]dpYearVals, horizon)
	for i := 0; i < horizon; i++ {
		perYear[i] = dpYearVals{
			rate:        pickPerYear(req.RatesPerYear, i, req.RateOfReturn),
			otherIncome: pickPerYear(req.OtherIncomePerYear, i, req.AnnualOtherIncome),
			ssBenefit:   pickPerYear(req.SSBenefitPerYear, i, req.AnnualSSBenefit),
			ltcg:        pickPerYear(req.TaxableDivLTCGPerYear, i, req.TaxableDivLTCG),
			age:         req.Age + i,
		}
	}

	// Two-stage DP: stage 1 is a (year, tradBucket, action) cost table that is
	// independent of the magi-history state. Only IRMAA depends on the prior
	// MAGI, so we add it inline in stage 2 and avoid recomputing the per-year
	// tax math 49 times for each (year, tradBucket, action) tuple.
	stepCache := make(map[[3]int32]dpStepCache)
	computeStep := func(yearIdx int, tradBucket int32, actionIdx int32) dpStepCache {
		k := [3]int32{int32(yearIdx), tradBucket, actionIdx}
		if v, ok := stepCache[k]; ok {
			return v
		}
		yv := perYear[yearIdx]
		tradStart := bucketDollars(tradBucket)
		var rmd float64
		if req.IncludeRMD && yv.age >= r.RmdStartAge && tradStart > 0 {
			rmd = tables.RMD(tradStart, yv.age)
		}
		conv := float64(actionIdx) * dpConvStep
		if conv > tradStart-rmd {
			conv = tradStart - rmd
		}
		if conv < 0 {
			conv = 0
		}
		taxableSS := tables.TaxableSS(yv.otherIncome+conv+rmd+yv.ltcg, yv.ssBenefit, req.FilingStatus)
		ordinaryTaxable := yv.otherIncome + conv + rmd + taxableSS
		afterStd := ordinaryTaxable - stdDed
		if afterStd < 0 {
			afterStd = 0
		}
		fedTax := tables.OrdinaryTax(afterStd, req.FilingStatus)
		stateTax := afterStd * r.StateRate
		magi := ordinaryTaxable + yv.ltcg
		niit := tables.NIIT(magi, yv.ltcg, req.FilingStatus)
		var aca float64
		if yv.age < 65 && req.AcaHouseholdSize > 0 && req.AcaAnnualPremium > 0 {
			fpl := tables.ACA400PctFPL(req.AcaHouseholdSize)
			if fpl > 0 && magi > fpl {
				aca = req.AcaAnnualPremium
			}
		}
		nextTrad := (tradStart - conv - rmd) * (1 + yv.rate)
		if nextTrad < 0 {
			nextTrad = 0
		}
		v := dpStepCache{
			coreCost:    fedTax + stateTax + niit + aca,
			currentMAGI: magi,
			currentTier: tierIdx(magi),
			nextBucket:  snap(nextTrad),
		}
		stepCache[k] = v
		return v
	}

	// Terminal cost: tax on a lump-sum withdrawal of the remaining Traditional
	// balance in year H, on top of last-year recurring income. Monotone
	// increasing in tradEnd, which is what the DP needs to compare horizon
	// states honestly. Lump-sum is conservative versus a 4%-rule annuity proxy.
	terminalCost := func(tradEnd float64) float64 {
		if tradEnd <= 0 {
			return 0
		}
		last := perYear[horizon-1]
		ssBig := tables.TaxableSS(last.otherIncome+tradEnd+last.ltcg, last.ssBenefit, req.FilingStatus)
		ssZero := tables.TaxableSS(last.otherIncome+last.ltcg, last.ssBenefit, req.FilingStatus)
		afterBig := math.Max(0, last.otherIncome+tradEnd+ssBig-stdDed)
		afterZero := math.Max(0, last.otherIncome+ssZero-stdDed)
		fedDelta := tables.OrdinaryTax(afterBig, req.FilingStatus) - tables.OrdinaryTax(afterZero, req.FilingStatus)
		stateDelta := tradEnd * r.StateRate
		return fedDelta + stateDelta
	}

	costToGo := make(map[dpStateKey]float64, horizon*nBuckets*49)
	bestAction := make(map[dpStateKey]int32, horizon*nBuckets*49)

	var solve func(yearIdx int16, tradBucket int32, magi1, magi2 int8) float64
	solve = func(yearIdx int16, tradBucket int32, magi1, magi2 int8) float64 {
		if int(yearIdx) >= horizon {
			return terminalCost(bucketDollars(tradBucket))
		}
		key := dpStateKey{yearIdx, tradBucket, magi1, magi2}
		if v, ok := costToGo[key]; ok {
			return v
		}
		yv := perYear[yearIdx]
		tradStart := bucketDollars(tradBucket)
		var rmd float64
		if req.IncludeRMD && yv.age >= r.RmdStartAge && tradStart > 0 {
			rmd = tables.RMD(tradStart, yv.age)
		}
		maxConv := tradStart - rmd
		if maxConv < 0 {
			maxConv = 0
		}
		nActions := int(math.Floor(maxConv/dpConvStep)) + 1
		if nActions < 1 {
			nActions = 1
		}

		magi2Center := tierCenter(magi2)
		var irmaa float64
		if yv.age >= 65 {
			irmaa = tables.IRMAA(magi2Center, req.FilingStatus, yv.age)
		}

		bestCost := math.Inf(1)
		var bestAct int32
		for a := int32(0); a < int32(nActions); a++ {
			step := computeStep(int(yearIdx), tradBucket, a)
			future := solve(yearIdx+1, step.nextBucket, step.currentTier, magi1)
			total := step.coreCost + irmaa + future
			if total < bestCost {
				bestCost = total
				bestAct = a
			}
		}
		costToGo[key] = bestCost
		bestAction[key] = bestAct
		return bestCost
	}

	initBucket := snap(r.StartTrad)
	initMagi1 := tierIdx(req.MAGIOneYearAgo)
	initMagi2 := tierIdx(req.MAGITwoYearsAgo)
	solve(0, initBucket, initMagi1, initMagi2)

	// Forward walk: replay the policy through ProjectYear so the response
	// reflects exact (un-bucketed) projection math, not the DP's bucket grid.
	state := domain.YearState{Trad: r.StartTrad, Roth: r.StartRoth, Age: req.Age, CalYear: r.Year}
	in := domain.YearInputs{
		Tables:           tables,
		Status:           req.FilingStatus,
		StateRate:        r.StateRate,
		IncludeRMD:       req.IncludeRMD,
		RmdStartAge:      r.RmdStartAge,
		AcaHouseholdSize: req.AcaHouseholdSize,
		AcaAnnualPremium: req.AcaAnnualPremium,
	}

	magiPrev2 := req.MAGITwoYearsAgo
	magiPrev1 := req.MAGIOneYearAgo
	years := make([]domain.ScenarioYear, 0, horizon)
	var sumFedTax, sumStateTax, sumConv, sumRMD, sumIRMAA, sumTaxableSS, sumNIIT, sumACA float64

	for i := 0; i < horizon; i++ {
		yv := perYear[i]
		in.OtherIncome = yv.otherIncome
		in.AnnualSSBenefit = yv.ssBenefit
		in.TaxableDivLTCG = yv.ltcg
		in.Rate = yv.rate
		in.MAGITwoYearsAgo = magiPrev2

		key := dpStateKey{int16(i), snap(state.Trad), tierIdx(magiPrev1), tierIdx(magiPrev2)}
		actBucket, ok := bestAction[key]
		var convDollars float64
		if ok {
			convDollars = float64(actBucket) * dpConvStep
		}

		picked := convDollars
		var year domain.ScenarioYear
		year, state = domain.ProjectYear(state, in, func(s domain.YearState, rmd float64) float64 {
			cap := s.Trad - rmd
			if cap < 0 {
				return 0
			}
			if picked > cap {
				return cap
			}
			return picked
		})
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

	bracketTop := tables.BracketTop(req.TargetBracketRate, req.FilingStatus)

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
				TotalNIIT:           domain.Round(sumNIIT),
				TotalACAPenalty:     domain.Round(sumACA),
			},
		},
		Brackets:          tables.OrdinaryBrackets[req.FilingStatus],
		StandardDeduction: stdDed,
		StateTaxRate:      r.StateRate,
		TargetBracketRate: req.TargetBracketRate,
		TargetBracketTop:  bracketTop,
		IRMAATiers:        tables.IRMAATiers[req.FilingStatus],
		RespectIRMAA:      req.RespectIRMAAEnabled(),
		Strategy:          "dp",
	}, nil
}
