package app

import (
	"github.com/rs/zerolog"

	"github.com/ridopark/roth-converter/backend/internal/adapters/notifier"
	"github.com/ridopark/roth-converter/backend/internal/adapters/solver"
	"github.com/ridopark/roth-converter/backend/internal/adapters/taxtables"
	"github.com/ridopark/roth-converter/backend/internal/config"
	"github.com/ridopark/roth-converter/backend/internal/ports"
)

type Service struct {
	Cfg      config.Config
	Log      zerolog.Logger
	Tables   ports.TaxTablesRepo
	Matrix   ports.MatrixCalculator
	Notifier ports.Notifier
}

func Wire(cfg config.Config, log zerolog.Logger) (*Service, func(), error) {
	tables := taxtables.New(cfg.TaxTablesDir)
	var note ports.Notifier
	if cfg.DiscordWebhookURL != "" {
		note = notifier.NewDiscord(cfg.DiscordWebhookURL, log)
	} else {
		note = notifier.Noop{}
	}
	svc := &Service{
		Cfg:      cfg,
		Log:      log,
		Tables:   tables,
		Matrix:   solver.New(tables, log),
		Notifier: note,
	}
	cleanup := func() {}
	return svc, cleanup, nil
}
