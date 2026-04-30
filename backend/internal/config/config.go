package config

import "os"

type Config struct {
	Port              string
	LogLevel          string
	FrontendURL       string
	CORSAllowOrigin   string
	TaxTablesDir      string
	DefaultTaxYear    string
	DiscordWebhookURL string
}

func Load() Config {
	return Config{
		Port:              env("PORT", "8090"),
		LogLevel:          env("LOG_LEVEL", "info"),
		FrontendURL:       env("FRONTEND_URL", "http://localhost:3010"),
		CORSAllowOrigin:   env("CORS_ALLOW_ORIGIN", "http://localhost:3010"),
		TaxTablesDir:      env("TAX_TABLES_DIR", "./data"),
		DefaultTaxYear:    env("DEFAULT_TAX_YEAR", "2026"),
		DiscordWebhookURL: env("DISCORD_WEBHOOK_URL", ""),
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
