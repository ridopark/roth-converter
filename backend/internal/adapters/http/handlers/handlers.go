package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/rs/zerolog"

	"github.com/ridopark/roth-converter/backend/internal/app"
	"github.com/ridopark/roth-converter/backend/internal/domain"
)

type Handlers struct {
	svc *app.Service
	log zerolog.Logger
}

func New(svc *app.Service, log zerolog.Logger) *Handlers {
	return &Handlers{
		svc: svc,
		log: log.With().Str("component", "handlers").Logger(),
	}
}

func (h *Handlers) Matrix(w http.ResponseWriter, r *http.Request) {
	var req domain.MatrixRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	resp, err := h.svc.Matrix.Compute(req)
	if err != nil {
		h.log.Error().Err(err).Msg("matrix compute failed")
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handlers) Brackets(w http.ResponseWriter, r *http.Request) {
	status := domain.FilingStatus(r.URL.Query().Get("status"))
	if !status.Valid() {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid filing status"})
		return
	}
	year := 2026
	if y := r.URL.Query().Get("year"); y != "" {
		if v, err := strconv.Atoi(y); err == nil && v > 0 {
			year = v
		}
	}
	tables, err := h.svc.Tables.Get(year)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"brackets":           tables.OrdinaryBrackets[status],
		"standard_deduction": tables.StandardDeduction[status],
	})
}

func (h *Handlers) Visit(w http.ResponseWriter, r *http.Request) {
	country := r.Header.Get("CF-IPCountry")
	if country == "" {
		country = "?"
	}
	referrer := r.Header.Get("Referer")
	if referrer == "" {
		referrer = "(direct)"
	}
	ua := r.Header.Get("User-Agent")
	body := "country: " + country + "\nreferrer: " + referrer + "\nua: " + ua
	h.svc.Notifier.Notify("roth-converter visit", body)
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
