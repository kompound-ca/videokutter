# Kompound VideoCutter - Baseline Architecture

## Environment Versions

**Development Environment (Windows 11):**
- Docker: 28.4.0
- Docker Compose: v2.39.4-desktop.1
- Go: go1.25.1 windows/amd64
- OS: Windows 11
- Shell: PowerShell 7.5.3

**Production Environment (Azure VM):**
- OS: Ubuntu 22.04
- vCPU: 2
- RAM: 4GB
- IOPS: 6400

## Current Architecture

### Container Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Production Mode                           │
├─────────────────────────────────────────────────────────────┤
│  nginx-lb:443/80 ──┐                                       │
│  (nginx:alpine)    │    ┌─videocutter:8080                │  
│  - SSL termination │────┤ (golang:1.22-alpine)             │
│  - Load balancer   │    │ - Go Fiber web server             │
│  - Static files    │    │ - FFmpeg processing               │
│                    │    │ - 3.2GB memory limit              │
│  certbot           │    │ - Chunked upload handling         │
│  (dns-cloudflare)  │    └───────────────────────────────────│
│  - SSL cert issue  │                                        │
│  - No auto-renewal │                                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Development Mode                           │
├─────────────────────────────────────────────────────────────┤
│  videocutter:8080                                           │
│  (direct access, no SSL)                                    │
└─────────────────────────────────────────────────────────────┘
```

### Service Communication Flow

```
Client Upload Request Flow:
1. POST /api/upload/init      (initialize chunked upload)
2. POST /api/upload/chunk     (upload 5MB chunks in parallel)
3. POST /api/upload/complete  (assemble chunks)
4. GET  /api/metadata/{file}  (extract video metadata)
5. GET  /api/preview/{file}   (serve original file for preview)

Processing Flow:
Upload → AssembleChunks → FFprobe → ServeOriginal
```

### SSL/Certificate Configuration

**Current Setup (CRITICAL ISSUE):**
- Uses certbot/dns-cloudflare for Cloudflare DNS validation
- Runs once for initial certificate issuance
- **NO AUTOMATIC RENEWAL CONFIGURED**
- Warning message "Certbot doesn't know how to automatically configure the web server" is expected for webroot mode

**Nginx ACME Challenge:**
- Location /.well-known/acme-challenge/ configured
- Volume mounted: ./certbot-data:/var/www/certbot

### Upload Processing Pipeline

**Current Flow:**
1. **Chunked Upload**: 5MB chunks, 3 parallel streams
2. **Assembly**: Sequential concatenation in temp directory
3. **Metadata Extraction**: Full FFprobe scan of assembled file
4. **Preview Serving**: Direct serving of original file through Go proxy

**Identified Bottlenecks:**
- No immediate preview generation
- Full file FFprobe scan (slow on large files)
- No browser-compatible preview for MOV files
- Sequential processing (no parallelization)

### File Format Support

**Supported Upload Formats:**
- MP4, AVI, MOV, MKV, WebM, M4V (up to 10GB)

**Browser Preview Compatibility:**
- ✅ MP4/H.264: Works natively
- ✅ MP4/AV1: Works in modern browsers
- ❌ MOV files: Container not supported by browsers
- ❌ MOV/ProRes: Codec not supported by browsers

### Resource Constraints (Production)

**Current Limits:**
- 2 vCPU total
- 4GB RAM total
- No FFmpeg thread limiting
- No concurrency controls on processing
- Single container handles all processing

## Performance Baseline

### Upload-to-Preview Timing (To Be Measured)

**Test Files Needed:**
1. 100MB MP4/H.264 file
2. 2GB MOV file
3. Large WebM file

**Measurements to Collect:**
- t0: First chunk upload start
- t1: Last chunk upload complete
- t2: Assembly complete
- t3: Metadata extraction complete
- t4: Preview available/page usable

*Baseline measurements pending - need test environment setup*

## Configuration Files

**Active Configuration:**
- `compose.yaml` (actual deployment file)
- `nginx-lb.conf` (nginx configuration template)
- `Dockerfile` (multi-stage Go build)

**Missing Configuration:**
- No `.env` file in repo (using .env.example)
- No production docker-compose.yml

## Deployment Rules

**Development:**
```bash
# For Go code changes
docker compose down && docker compose up -d --build

# View logs (bounded)
docker compose logs --tail=200 videocutter
```

**Production:**
```bash
# Deploy with profiles
docker compose --profile production up -d --build

# Check certbot status (bounded)
docker logs --tail=400 --since=72h videocutter-certbot
```

## Immediate Issues Identified

1. **SSL Auto-Renewal**: Missing automatic certificate renewal
2. **MOV Preview**: MOV files fail to play in browsers  
3. **Processing Speed**: Sequential processing causes delays
4. **Resource Usage**: No limits on FFmpeg CPU usage
5. **No Preview Generation**: Original files served directly

## Next Phase

Proceed to Phase 1: Certbot/SSL audit and auto-renewal implementation.