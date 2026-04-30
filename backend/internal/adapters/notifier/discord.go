package notifier

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"

	"github.com/rs/zerolog"
)

type Discord struct {
	url    string
	log    zerolog.Logger
	client *http.Client
}

func NewDiscord(webhookURL string, log zerolog.Logger) *Discord {
	return &Discord{
		url:    webhookURL,
		log:    log.With().Str("component", "notifier").Logger(),
		client: &http.Client{Timeout: 5 * time.Second},
	}
}

type Noop struct{}

func (Noop) Notify(string, string) {}

func (d *Discord) Notify(title, body string) {
	if d.url == "" {
		return
	}
	go d.send(title, body)
}

func (d *Discord) send(title, body string) {
	payload := map[string]any{
		"embeds": []map[string]any{{
			"title":       title,
			"description": body,
			"color":       0xF59E0B,
		}},
	}
	bs, err := json.Marshal(payload)
	if err != nil {
		d.log.Warn().Err(err).Msg("notifier: marshal failed")
		return
	}
	resp, err := d.client.Post(d.url, "application/json", bytes.NewReader(bs))
	if err != nil {
		d.log.Warn().Err(err).Msg("notifier: post failed")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		d.log.Warn().Int("status", resp.StatusCode).Msg("notifier: non-2xx response")
	}
}
