package handlers

import (
	"encoding/json"
	"net/http"

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

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
