package router

import (
	"encoding/json"
	"net/http"

	"github.com/rs/zerolog"

	"github.com/ridopark/roth-converter/backend/internal/adapters/http/handlers"
	"github.com/ridopark/roth-converter/backend/internal/app"
	"github.com/ridopark/roth-converter/backend/internal/config"
)

func New(svc *app.Service, cfg config.Config, log zerolog.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health)

	h := handlers.New(svc, log)
	mux.HandleFunc("POST /matrix", h.Matrix)

	return cors(cfg.CORSAllowOrigin, mux)
}

func health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func cors(origin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
