# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Kompound VideoCutter is a lossless video cutting web application built with Go, Fiber, and FFmpeg. It allows users to upload videos up to 10GB, select cut ranges with an interactive timeline, and download processed videos instantly.

## Essential Commands

### Development (Native Go)

```bash
# Setup environment
cp .env.example .env
go mod download

# Build and run
go run main.go

# Build executable (required for changes to take effect)
go build -o videocutter .
./videocutter
```

### Docker Development (Recommended)

```bash
# Build and start container
docker compose up -d --build

# View logs (detached - never run inline console apps)
docker compose logs -f videocutter

# Restart after code changes (REQUIRED - never just restart)
docker compose down && docker compose up -d --build

# Stop
docker compose down
```

### Testing & Verification

```bash
# Health check
curl http://localhost:8080/api/health

# Test upload (requires actual video file)
curl -X POST -F "video=@test.mp4" http://localhost:8080/api/upload
```

## Architecture

### Backend Structure (Go + Fiber)

- **main.go**: Application entry point, HTTP server setup with Fiber framework
- **internal/handlers/**: HTTP request handlers (video.go)
- **internal/services/**: Business logic layer (video.go, file.go)  
- **internal/models/**: Data models and API structures (video.go)

### Service Layer Architecture

**VideoService**: FFmpeg integration for video processing
- `GetVideoMetadata()`: Uses ffprobe to extract video information
- `CutVideo()`: Lossless video cutting with ffmpeg stream copy
- `ValidateVideoFormat()`: Supports MP4, AVI, MOV, MKV

**FileService**: File management and storage
- `SaveUploadedFile()`: Handles 10GB uploads with automatic cleanup
- `GenerateOutputFilename()`: Creates timestamped output files
- `CleanupPreviousFiles()`: Maintains only last processed video

### API Endpoints

- `POST /api/upload`: Upload video, extract metadata
- `GET /api/metadata/{filename}`: Retrieve video metadata
- `POST /api/cut`: Cut video with start/end times
- `GET /api/download/{filename}`: Download processed video
- `GET /api/health`: Health check endpoint

### Frontend (Vanilla JS)

- **Single-page application** with drag-and-drop upload
- **Interactive timeline** for cut range selection
- **Real-time progress** indication during processing
- Located in `static/` directory (index.html, css/style.css, js/app.js)

## Key Dependencies

### Runtime Dependencies
- **FFmpeg & FFprobe**: Required in PATH for video processing
- **Go 1.21+**: Backend runtime
- **Alpine Linux**: Container base with FFmpeg pre-installed

### Go Modules
- `github.com/gofiber/fiber/v2`: HTTP framework
- `github.com/google/uuid`: UUID generation for file naming

## Configuration

### Environment Variables (.env)
```env
PORT=8080                    # Server port
TEMP_DIR=./temp             # File storage location
LOG_LEVEL=info              # Logging level
```

### File Limits
- **Maximum upload**: 10GB per file
- **Supported formats**: MP4, AVI, MOV, MKV
- **Automatic cleanup**: Only last processed file retained

## Container Architecture

### Multi-stage Build
- **Build stage**: golang:1.21-alpine with build dependencies
- **Runtime stage**: alpine:latest with FFmpeg, runs as non-root user
- **Security**: Unprivileged execution, resource limits (2GB RAM, 2 CPU)

### Volume Management
- `videocutter_temp:/app/temp`: Persistent storage for uploaded/processed files
- Files survive container restarts but are cleaned up automatically

## Development Workflow

### Making Code Changes
1. Modify Go source files
2. **MUST** rebuild: `docker compose down && docker compose up -d --build`
3. **OR** for native: rebuild binary with `go build -o videocutter .`

### Adding New Features
- **Handlers**: Add endpoints in `internal/handlers/video.go`
- **Services**: Business logic in `internal/services/`
- **Models**: Data structures in `internal/models/video.go`
- **Frontend**: Static files in `static/` directory

### Debugging
- Use `docker compose logs -f videocutter` for container logs
- FFmpeg errors appear in service layer stderr output
- API responses include detailed error messages

## FFmpeg Integration

### Video Processing
- **Lossless cutting**: Uses `-c copy` for stream copying without re-encoding
- **Time format**: Converts Go time.Duration to HH:MM:SS.mmm for FFmpeg
- **Error handling**: Captures stderr for detailed error reporting

### Metadata Extraction
- **ffprobe**: JSON output parsing for comprehensive video information
- **Stream analysis**: Separate video/audio codec detection
- **Duration/resolution**: Automatic extraction from format metadata

## Production Considerations

### Resource Requirements
- **Minimum**: 512MB RAM, 1 CPU core, 10GB disk
- **Recommended**: 2GB RAM, 2 CPU cores, 50GB+ disk
- **Network**: Stable connection for large file uploads

### Security
- Non-root container execution
- File type validation and size limits
- Input sanitization for all user data
- Temporary storage with automatic cleanup

### Deployment
- Use reverse proxy (nginx) for HTTPS termination
- Configure proper log aggregation
- Monitor container health with built-in health checks
- Set up backup strategy for important processed videos