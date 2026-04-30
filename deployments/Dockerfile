FROM golang:1.22-bookworm AS builder

WORKDIR /build

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ .
RUN CGO_ENABLED=0 GOOS=linux go build -o /roth-server ./cmd/roth-server

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /roth-server /roth-server
COPY data /data

EXPOSE 8092

ENTRYPOINT ["/roth-server"]
