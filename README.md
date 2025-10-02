<img src="https://raw.githubusercontent.com/kompound-ca/videokutter/b69a6be6f2a295a563d63464ccb7d51338be267d/static/icon/kompound.svg?token=A7QKVLXWHP7BGA3LC727DD3I32QR6" alt="Kompound Logo" width="250">

# Kompound Video Kutter

A modern, browser-based video cutting tool that processes videos entirely client-side using WebAssembly and FFmpeg. No server uploads required - all processing happens in your browser for maximum privacy and speed.

## Features

- **100% Browser-Based**: All video processing happens locally in your browser
- **No Upload Required**: Videos never leave your device
- **Lossless Cutting**: Uses FFmpeg stream copying for fast, quality-preserving cuts
- **Persistent Storage**: Optional browser storage to keep videos between sessions
- **Dark Mode**: Built-in dark/light theme toggle with system preference detection
- **Supported Formats**: MP4, AVI, MOV, MKV, WebM, M4V
- **Interactive Timeline**: Visual timeline with draggable handles for precise cuts
- **Real-time Preview**: Preview your cuts before processing

## Requirements

- Modern web browser with WebAssembly support (Chrome, Firefox, Edge, Safari)
- Go 1.19+ (for running the server)
- Docker (optional, for containerized deployment)

## Quick Start

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/kompound-ca/videokutter.git
cd videokutter
```

2. Run with Go:
```bash
go mod download
go run main.go
```

3. Access the application:
```
http://localhost:8080
```

### Docker Deployment

1. Clone and configure:
```bash
git clone https://github.com/kompound-ca/videokutter.git
cd videokutter
cp .env.example .env
cp docker-compose.example.yml docker-compose.yml
```

2. Build and run:
```bash
docker compose up -d --build
```

3. Access the application:
```
http://localhost:8080
```

## Usage

1. **Upload Video**: 
   - Click the upload area or drag & drop your video file
   - Videos are stored locally in your browser's IndexedDB

2. **Select Video**: 
   - Go to the Library tab to see all uploaded videos
   - Click "Select" on the video you want to cut

3. **Cut Video**:
   - Use the timeline handles or input precise timestamps
   - Click "Cut Video" to process
   - Processing happens entirely in your browser

4. **Download**:
   - Processed videos appear in the "Processed" tab
   - Click "Download" to save to your device

## Browser Storage

The application offers two storage modes:

- **Temporary Storage** (Default): Browser may clear data when space is needed
- **Persistent Storage** (Recommended): Videos remain until manually deleted

To enable persistent storage, toggle the switch in the Storage Settings section.

## Configuration

Environment variables (`.env`):

```env
PORT=8080                    # Server port
LOG_LEVEL=info              # Logging level (debug, info, warn, error)
LOG_REQUESTS=true           # Enable request logging
COMPOSE_PROFILES=production   # Set to "production" for production mode with nginx and SSL certificates. Set to "development" for local development without SSL/nginx (direct Go server access).
DOMAIN=videocutter.local   # DOMAIN specifies the domain name used for SSL certificates and nginx configuration
```

## License

Copyright © 2025 Kompound (https://kompound.ca)

This project is licensed under the GNU General Public License v3.0 (GPL-3.0).

### Third-Party Licenses

- **FFmpeg.wasm**: Licensed under LGPL 2.1. Used for video processing in the browser.
- **Go Fiber**: MIT License. Web framework for the server.

For full license terms, see the [LICENSE](LICENSE) file.

## Support

For issues, feature requests, or questions, please open an issue on GitHub.

---

[Kompound](https://kompound.ca)


