# Kompound Video Kutter - Browser Edition

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
git clone https://github.com/kompound-ca/Kompound-VideoCutter.git
cd Kompound-VideoCutter
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
git clone https://github.com/kompound-ca/Kompound-VideoCutter.git
cd Kompound-VideoCutter
cp .env.example .env
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
```

## Technical Details

- **Frontend**: Pure JavaScript with WebAssembly-based FFmpeg
- **Backend**: Minimal Go server for serving static files
- **Processing**: FFmpeg.wasm for client-side video processing
- **Storage**: Browser IndexedDB for video persistence
- **Styling**: Custom CSS with CSS variables for theming

## Browser Compatibility

- Chrome/Edge 90+
- Firefox 89+
- Safari 15+
- Opera 76+

Requires WebAssembly, IndexedDB, and modern JavaScript support.

## Development

### Project Structure
```
Kompound-VideoCutter/
├── static/
│   ├── browser-cutter.html    # Main HTML file
│   ├── css/
│   │   └── browser-cutter.css # Styles with dark mode
│   ├── js/
│   │   ├── browser-cutter.js  # Main application logic
│   │   ├── video-cutter-ultra.js # Core video processing
│   │   └── video-worker.js    # Web Worker for processing
│   └── icon/
│       └── kompound.svg       # Application icon
├── main.go                    # Go server
├── docker-compose.yml         # Docker configuration
├── Dockerfile                 # Container build file
└── README.md                  # This file
```

### Building from Source

```bash
# Install dependencies
go mod download

# Build binary
go build -o videocutter main.go

# Run
./videocutter
```

## License

Copyright © 2025 Kompound (https://kompound.ca)

This project is licensed under the GNU General Public License v3.0 (GPL-3.0).

### What this means:

- ✅ **You CAN**: Use, modify, and distribute this software
- ✅ **You CAN**: Use it for personal or internal business purposes
- ❌ **You CANNOT**: Use it commercially without sharing your modifications
- ❌ **You CANNOT**: Distribute it without providing source code
- ❌ **You CANNOT**: Change the license or remove attribution

### Third-Party Licenses

- **FFmpeg.wasm**: Licensed under LGPL 2.1. Used for video processing in the browser.
- **Go Fiber**: MIT License. Web framework for the server.

For full license terms, see the [LICENSE](LICENSE) file.

## Support

For issues, feature requests, or questions, please open an issue on GitHub.

---

Made with ❤️ by [Kompound](https://kompound.ca)


