package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ridopark/roth-converter/backend/internal/adapters/notifier"
	"github.com/ridopark/roth-converter/backend/internal/adapters/optimizer"
	"github.com/ridopark/roth-converter/backend/internal/adapters/solver"
	"github.com/ridopark/roth-converter/backend/internal/adapters/taxtables"
	"github.com/ridopark/roth-converter/backend/internal/app"
	"github.com/ridopark/roth-converter/backend/internal/config"
)

// newTestHandlers wires the real adapters against the repo's data/ directory.
// We use the actual JSON fixture so the wire layer is tested end-to-end.
func newTestHandlers(t *testing.T) *Handlers {
	t.Helper()
	log := zerolog.Nop()
	tables := taxtables.New("../../../../../data")
	bracket := optimizer.New(tables, log)
	dp := optimizer.NewDP(tables, log)
	svc := &app.Service{
		Cfg:       config.Config{},
		Log:       log,
		Tables:    tables,
		Matrix:    solver.New(tables, log),
		Optimizer: optimizer.NewRouter(bracket, dp),
		Notifier:  notifier.Noop{},
	}
	return New(svc, log)
}

func decodeJSON(t *testing.T, w *httptest.ResponseRecorder, into any) {
	t.Helper()
	require.NoError(t, json.NewDecoder(w.Body).Decode(into))
}

func TestMatrix_HappyPath(t *testing.T) {
	h := newTestHandlers(t)
	body := bytes.NewBufferString(`{
		"age": 60, "birth_year": 1966, "total_401k": 100000,
		"traditional_pct": 1.0, "filing_status": "mfj",
		"horizon_years": 1, "rates_of_return": [0], "conversion_cases": [0]
	}`)
	req := httptest.NewRequest(http.MethodPost, "/matrix", body)
	w := httptest.NewRecorder()
	h.Matrix(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	decodeJSON(t, w, &resp)
	assert.Contains(t, resp, "scenarios")
	assert.Contains(t, resp, "brackets")
	assert.Contains(t, resp, "irmaa_tiers")
}

func TestMatrix_BadJSON(t *testing.T) {
	h := newTestHandlers(t)
	req := httptest.NewRequest(http.MethodPost, "/matrix", strings.NewReader("not json"))
	w := httptest.NewRecorder()
	h.Matrix(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
	var resp map[string]string
	decodeJSON(t, w, &resp)
	assert.Equal(t, "invalid json", resp["error"])
}

func TestMatrix_ValidationFailure(t *testing.T) {
	h := newTestHandlers(t)
	body := bytes.NewBufferString(`{
		"age": 0, "filing_status": "mfj", "total_401k": 100000,
		"horizon_years": 1, "rates_of_return": [0], "conversion_cases": [0]
	}`)
	req := httptest.NewRequest(http.MethodPost, "/matrix", body)
	w := httptest.NewRecorder()
	h.Matrix(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
	var resp map[string]string
	decodeJSON(t, w, &resp)
	assert.NotEmpty(t, resp["error"])
}

func TestOptimize_HappyPathBracketFill(t *testing.T) {
	h := newTestHandlers(t)
	body := bytes.NewBufferString(`{
		"age": 60, "birth_year": 1966, "total_401k": 1000000,
		"traditional_pct": 1.0, "filing_status": "mfj",
		"annual_other_income": 50000, "horizon_years": 3,
		"rate_of_return": 0.05, "target_bracket_rate": 0.12
	}`)
	req := httptest.NewRequest(http.MethodPost, "/optimize", body)
	w := httptest.NewRecorder()
	h.Optimize(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	decodeJSON(t, w, &resp)
	assert.Equal(t, "bracket_fill", resp["strategy"])
	assert.Contains(t, resp, "plan")
}

func TestOptimize_StrategyDPRoutes(t *testing.T) {
	h := newTestHandlers(t)
	body := bytes.NewBufferString(`{
		"age": 60, "birth_year": 1966, "total_401k": 200000,
		"traditional_pct": 1.0, "filing_status": "mfj",
		"annual_other_income": 50000, "horizon_years": 3,
		"rate_of_return": 0.05, "target_bracket_rate": 0.12,
		"strategy": "dp"
	}`)
	req := httptest.NewRequest(http.MethodPost, "/optimize", body)
	w := httptest.NewRecorder()
	h.Optimize(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	decodeJSON(t, w, &resp)
	assert.Equal(t, "dp", resp["strategy"])
}

func TestOptimize_BadJSON(t *testing.T) {
	h := newTestHandlers(t)
	req := httptest.NewRequest(http.MethodPost, "/optimize", strings.NewReader("not json"))
	w := httptest.NewRecorder()
	h.Optimize(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestOptimize_InvalidTargetBracket(t *testing.T) {
	h := newTestHandlers(t)
	body := bytes.NewBufferString(`{
		"age": 60, "birth_year": 1966, "total_401k": 1000000,
		"traditional_pct": 1.0, "filing_status": "mfj",
		"horizon_years": 3, "rate_of_return": 0.05, "target_bracket_rate": 0.99
	}`)
	req := httptest.NewRequest(http.MethodPost, "/optimize", body)
	w := httptest.NewRecorder()
	h.Optimize(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestBrackets_HappyPath(t *testing.T) {
	h := newTestHandlers(t)
	req := httptest.NewRequest(http.MethodGet, "/brackets?status=mfj&year=2026", nil)
	w := httptest.NewRecorder()
	h.Brackets(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	decodeJSON(t, w, &resp)
	assert.Contains(t, resp, "brackets")
	assert.Contains(t, resp, "standard_deduction")
}

func TestBrackets_BadStatus(t *testing.T) {
	h := newTestHandlers(t)
	req := httptest.NewRequest(http.MethodGet, "/brackets?status=garbage", nil)
	w := httptest.NewRecorder()
	h.Brackets(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestBrackets_DefaultYear(t *testing.T) {
	h := newTestHandlers(t)
	req := httptest.NewRequest(http.MethodGet, "/brackets?status=single", nil)
	w := httptest.NewRecorder()
	h.Brackets(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestStates_HappyPath(t *testing.T) {
	h := newTestHandlers(t)
	req := httptest.NewRequest(http.MethodGet, "/states?year=2026", nil)
	w := httptest.NewRecorder()
	h.States(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	decodeJSON(t, w, &resp)
	noTax, ok := resp["no_tax"].([]any)
	require.True(t, ok)
	assert.NotEmpty(t, noTax, "expected at least one no-tax state in 2026 fixture")
	rates, ok := resp["rates"].(map[string]any)
	require.True(t, ok)
	assert.NotEmpty(t, rates)
}

func TestStates_DefaultYear(t *testing.T) {
	h := newTestHandlers(t)
	req := httptest.NewRequest(http.MethodGet, "/states", nil)
	w := httptest.NewRecorder()
	h.States(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
}
