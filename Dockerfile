# Minimal Dockerfile for Browser-Only VideoCutter

# Build stage
FROM golang:1.22-alpine AS builder

# Install build tools
RUN apk add --no-cache ca-certificates git

WORKDIR /app

# Copy go files for dependency caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source and build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags='-w -s' -o videocutter .

# Runtime stage - minimal Alpine (no FFmpeg needed for browser-only version)
FROM alpine:3.19

# Install minimal runtime dependencies and create user
RUN apk add --no-cache ca-certificates wget && \
    adduser -D appuser

WORKDIR /app

# Copy the binary and static files
COPY --from=builder --chown=appuser:appuser /app/videocutter .
COPY --from=builder --chown=appuser:appuser /app/static ./static

USER appuser

# Environment and runtime config
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=2 CMD wget -q --spider http://localhost:8080/api/health || exit 1
CMD ["./videocutter"]
