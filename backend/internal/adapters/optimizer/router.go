package optimizer

import (
	"github.com/ridopark/roth-converter/backend/internal/domain"
	"github.com/ridopark/roth-converter/backend/internal/ports"
)

// Router dispatches OptimizeRequest.Strategy to a concrete ConversionSolver.
// The default ("" or unknown) routes to bracket_fill, preserving v1 behaviour.
type Router struct {
	bracketFill ports.ConversionSolver
	dp          ports.ConversionSolver
}

func NewRouter(bracketFill, dp ports.ConversionSolver) *Router {
	return &Router{bracketFill: bracketFill, dp: dp}
}

func (r *Router) Solve(req domain.OptimizeRequest) (domain.OptimizePlan, error) {
	if req.Strategy == "dp" && r.dp != nil {
		return r.dp.Solve(req)
	}
	return r.bracketFill.Solve(req)
}
