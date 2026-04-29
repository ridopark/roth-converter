.PHONY: dev dev-backend dev-web test build clean

dev:
	./scripts/start.sh

dev-backend:
	cd backend && go run ./cmd/roth-server

dev-web:
	cd apps/web && npm run dev

test:
	cd backend && go test -race ./...

build:
	cd backend && go build -o bin/roth-server ./cmd/roth-server
	cd apps/web && npm run build

clean:
	rm -rf backend/bin apps/web/.next apps/web/out
