# Multi-stage Dockerfile for Kompound VideoCutter

# Build stage - use golang:alpine for faster builds
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

# Runtime stage - minimal Alpine with FFmpeg
FROM alpine:3.19

# Install runtime dependencies and create user in single layer
RUN apk add --no-cache ffmpeg ca-certificates wget && \
    adduser -D appuser && \
    mkdir -p /app/temp
WORKDIR /app
COPY --from=builder --chown=appuser:appuser /app/videocutter .
COPY --from=builder --chown=appuser:appuser /app/static ./static
USER appuser

# Environment and runtime config
ENV PORT=8080 TEMP_DIR=/app/temp
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=2 CMD wget -q --spider http://localhost:8080/api/health || exit 1
CMD ["./videocutter"]
