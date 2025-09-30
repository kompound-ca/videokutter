# Kompound VideoCutter

Web-based video cutting tool built with Go and FFmpeg. Upload videos, select cut ranges, and download processed files.

## Features

- Lossless video cutting using FFmpeg stream copying
- Support for files up to 10GB (MP4, AVI, MOV, MKV)
- Interactive timeline for precise cut selection
- Automatic file cleanup
- Dockerized deployment

## Quick Start

### Development Mode

1. Clone and configure:
   ```bash
   git clone https://github.com/kompound-ca/videocutter.git
   cd videocutter
   cp .env.example .env
   ```

2. Set development mode in `.env`:
   ```env
   COMPOSE_PROFILES=development
   ```

3. Start:
   ```bash
   docker compose up -d --build
   ```

4. Access: `http://localhost:8080`

### Production Mode

1. Set production mode in `.env`:
   ```env
   COMPOSE_PROFILES=production
   DOMAIN=your-domain.com
   ```

2. Start with SSL/nginx:
   ```bash
   docker compose --profile production up -d --build
   ```

3. Access: `https://your-domain.com`

## Configuration

Key variables in `.env`:

```env
COMPOSE_PROFILES=development  # or "production"
PORT=8080
DOMAIN=videocutter.local
HOST_UPLOAD_DIR=./temp
```

## API Documentation

### Endpoints

#### `POST /api/upload`
Upload a video file for processing.

**Request:** Multipart form with `video` field
**Response:**
```json
{
  "success": true,
  "message": "Video uploaded successfully",
  "data": {
    "filename": "sample_20241127_123456.mp4",
    "duration": 300000000000,
    "format": "mov,mp4,m4a,3gp,3g2,mj2",
    "resolution": "1920x1080",
    "size": 104857600,
    "bitrate": "2000000",
    "framerate": "30/1",
    "video_codec": "h264",
    "audio_codec": "aac",
    "uploaded_at": "2024-11-27T12:34:56Z"
  }
}
```

#### `GET /api/metadata/{filename}`
Retrieve metadata for an uploaded video.

**Response:** Same as upload response data

#### `POST /api/cut`
Cut a video with specified start and end times.

**Request:**
```json
{
  "filename": "sample_20241127_123456.mp4",
  "start_time": 30000000000,
  "end_time": 120000000000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Video cut completed",
  "data": {
    "output_filename": "sample_cut_20241127_124500.mp4",
    "success": true,
    "message": "Video cut successfully"
  }
}
```

#### `GET /api/download/{filename}`
Download a processed video file.

**Response:** Video file with appropriate Content-Type and Content-Disposition headers

#### `GET /api/health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok"
}
```



## Docker Commands

### Development with auto-rebuild
```bash
# Build and run
docker compose up -d --build

# View logs
docker compose logs -f videocutter

# Restart after code changes (required per user rules)
docker compose down && docker compose up -d --build

# Stop and remove
docker compose down
```

### Production deployment
```bash
# Run in production mode
docker compose -f docker-compose.yml up -d

# Update application
docker compose down && docker compose pull && docker compose up -d
```








### Resource Requirements
- **Minimum**: 512MB RAM, 1 CPU core, 10GB disk
- **Recommended**: 2GB RAM, 2 CPU cores, 50GB+ disk
- **Network**: Stable connection for large file uploads

## 📄 License & Credits

### FFmpeg License
This application uses FFmpeg, which is licensed under the [LGPL 2.1](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html) or later. FFmpeg is dynamically linked and not modified.

### Application License
Kompound VideoCutter is proprietary software owned by Kompound.ca.


