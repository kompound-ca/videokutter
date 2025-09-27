# 🎬 Kompound VideoCutter

A lossless video cutting web application for Kompound.ca, built with Go, Fiber, and FFmpeg. Upload videos up to 10GB, select cut ranges with an interactive timeline, and download processed videos instantly.

## ✨ Features

- **Lossless Video Cutting**: Uses FFmpeg with stream copying for pixel-perfect cuts
- **Large File Support**: Handle videos up to 10GB in size  
- **Interactive Timeline**: Visual drag-and-drop interface for precise cut selection
- **Multiple Formats**: Supports MP4, AVI, MOV, and MKV video files
- **Single-Page Interface**: Clean, responsive web UI with real-time progress indication
- **Docker Ready**: Fully containerized with docker-compose support
- **Auto Cleanup**: Maintains only the last processed video to save storage

## 🚀 Quick Start

### With Docker (Recommended)

1. **Clone the repository**
   ```bash
   git clone https://github.com/kompound-ca/videocutter.git
   cd videocutter
   ```

2. **Start with Docker Compose**
   ```bash
   docker compose up -d --build
   ```

3. **Access the application**
   Open your browser and navigate to `http://localhost:8080`

### Without Docker (Local Development)

**Prerequisites:**
- Go 1.22 or later
- FFmpeg and FFprobe installed and available in PATH

1. **Install dependencies**
   ```bash
   go mod download
   ```

2. **Create environment file**
   ```bash
   cp .env.example .env
   ```

3. **Run the application**
   ```bash
   go run main.go
   ```

## 🔧 Configuration

Create a `.env` file from `.env.example` and customize:

```env
# Server Configuration
PORT=8080

# File Storage Configuration  
TEMP_DIR=./temp

# Optional: Logging Level
LOG_LEVEL=info
```

## 📖 API Documentation

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

## 🎥 Usage Guide

### Step-by-Step Process

1. **Upload Video**
   - Drag and drop a video file (MP4, AVI, MOV, MKV) onto the upload area
   - Or click to browse and select a file
   - Maximum file size: 10GB

2. **Review Video Info**
   - View automatically extracted metadata (duration, resolution, codecs, etc.)
   - The timeline will initialize based on the video duration

3. **Select Cut Range**
   - Drag the green start marker to set the beginning of your cut
   - Drag the orange end marker to set the end of your cut  
   - Or click anywhere on the timeline to move the nearest marker
   - Time inputs show precise start/end times and cut duration

4. **Process Video**
   - Click "Cut Video" to start processing
   - Processing uses FFmpeg with lossless stream copying
   - Processing time depends on video size and cut duration

5. **Download Result**
   - Download button appears when processing completes
   - Click "Upload New Video" to start over with a different file

### Tips for Best Results

- **Lossless Cuts**: The app uses stream copying, so cuts are frame-accurate but may not be exactly at the requested time due to keyframe positions
- **Large Files**: For very large files, ensure stable network connection during upload
- **Precision**: Timeline provides visual guidance, but use the time inputs for precise values
- **Cleanup**: Each new upload automatically removes previous files to save space

## 🐳 Docker Commands

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

## 🏗️ Architecture

### Backend (Go + Fiber)
- **Fiber**: Fast HTTP framework with built-in middleware
- **FFmpeg Integration**: Command-line execution for video processing  
- **File Management**: Automatic cleanup and temporary storage
- **Error Handling**: Comprehensive validation and error responses

### Frontend (Vanilla JavaScript)
- **Single-Page App**: Modern ES6+ JavaScript with no framework dependencies
- **Interactive Timeline**: Custom drag-and-drop video timeline component
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **Real-time Feedback**: Upload progress and processing status updates

### Container Architecture
- **Multi-stage Build**: Optimized Docker image with separate build and runtime stages
- **Alpine Base**: Small, secure base image with FFmpeg pre-installed
- **Non-root User**: Security-focused container execution
- **Health Checks**: Built-in container health monitoring
- **Volume Mounting**: Persistent storage for temporary files

## 🔒 Security Considerations

- **File Validation**: Strict file type and size checking
- **Non-root Execution**: Container runs as unprivileged user
- **Input Sanitization**: All user inputs are validated and sanitized
- **Temporary Storage**: Files are automatically cleaned up
- **Resource Limits**: Memory and CPU constraints prevent resource exhaustion

## 🚀 Production Deployment

### Recommended Setup
1. Use a reverse proxy (nginx) for HTTPS termination
2. Set up proper log aggregation (e.g., ELK stack)
3. Monitor resource usage and container health
4. Configure backup strategy for important data
5. Set up proper firewall rules

### Environment Variables for Production
```env
PORT=8080
TEMP_DIR=/app/temp
LOG_LEVEL=warn
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

## 🤝 Contributing

This is a private project for Kompound.ca. For issues or feature requests, please contact the development team.

## 📞 Support

For technical support or questions:
- Create an issue in the repository
- Contact: support@kompound.ca
- Documentation: See this README and inline code comments

---

**Built with ❤️ for Kompound.ca**