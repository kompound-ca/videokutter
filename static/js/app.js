// Video Cutter App
class VideoCutterApp {
    constructor() {
        this.currentMetadata = null;
        this.isDragging = false;
        this.dragTarget = null;
        this.timelineDuration = 0;
        this.startTime = 0;
        this.endTime = 0;
        this.outputFilename = null;
        
        this.initializeElements();
        this.bindEvents();
        this.showSection('upload-section');
    }

    initializeElements() {
        // Sections
        this.sections = {
            upload: document.getElementById('upload-section'),
            player: document.getElementById('player-section'),
            processing: document.getElementById('processing-section'),
            download: document.getElementById('download-section'),
            error: document.getElementById('error-section')
        };

        // Upload elements
        this.uploadArea = document.getElementById('upload-area');
        this.videoInput = document.getElementById('video-input');
        this.progressContainer = document.getElementById('upload-progress');
        this.progressFill = document.getElementById('progress-fill');
        this.progressText = document.getElementById('progress-text');

        // Player elements
        this.videoPlayer = document.getElementById('video-player');
        this.videoInfo = document.getElementById('video-info');
        this.currentTimeDisplay = document.getElementById('current-time-display');

        // Timeline elements
        this.timeline = document.getElementById('timeline');
        this.startMarker = document.getElementById('start-marker');
        this.endMarker = document.getElementById('end-marker');
        this.timelineSelection = document.getElementById('timeline-selection');
        this.startTimeInput = document.getElementById('start-time');
        this.endTimeInput = document.getElementById('end-time');
        this.cutDuration = document.getElementById('cut-duration');
        this.cutButton = document.getElementById('cut-button');

        // Download elements
        this.downloadButton = document.getElementById('download-button');
        this.newVideoButton = document.getElementById('new-video-button');

        // Error elements
        this.errorMessage = document.getElementById('error-message');
        this.retryButton = document.getElementById('retry-button');
    }

    bindEvents() {
        // Upload events
        this.uploadArea.addEventListener('click', () => this.videoInput.click());
        this.uploadArea.addEventListener('dragover', this.handleDragOver.bind(this));
        this.uploadArea.addEventListener('dragleave', this.handleDragLeave.bind(this));
        this.uploadArea.addEventListener('drop', this.handleDrop.bind(this));
        this.videoInput.addEventListener('change', this.handleFileSelect.bind(this));

        // Timeline events
        this.startMarker.addEventListener('mousedown', this.startDrag.bind(this));
        this.endMarker.addEventListener('mousedown', this.startDrag.bind(this));
        this.timeline.addEventListener('click', this.handleTimelineClick.bind(this));
        document.addEventListener('mousemove', this.handleDrag.bind(this));
        document.addEventListener('mouseup', this.stopDrag.bind(this));

        // Video player events
        this.videoPlayer.addEventListener('loadedmetadata', this.initializeTimeline.bind(this));
        this.videoPlayer.addEventListener('timeupdate', this.updateVideoProgress.bind(this));

        // Button events
        this.cutButton.addEventListener('click', this.cutVideo.bind(this));
        this.downloadButton.addEventListener('click', this.downloadVideo.bind(this));
        this.newVideoButton.addEventListener('click', this.resetApp.bind(this));
        this.retryButton.addEventListener('click', this.resetApp.bind(this));
    }

    // Drag and Drop handlers
    handleDragOver(e) {
        e.preventDefault();
        this.uploadArea.classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        this.uploadArea.classList.remove('dragover');
    }

    handleDrop(e) {
        e.preventDefault();
        this.uploadArea.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            this.processFile(files[0]);
        }
    }

    handleFileSelect(e) {
        const files = e.target.files;
        if (files.length > 0) {
            this.processFile(files[0]);
        }
    }

    // File processing
    processFile(file) {
        // Validate file type - be more permissive with MIME types as they can vary
        const allowedTypes = [
            'video/mp4', 'video/avi', 'video/mov', 'video/quicktime', 
            'video/x-matroska', 'video/webm', 'video/x-msvideo',
            'application/octet-stream' // Some video files may have generic MIME type
        ];
        
        // Also check file extension as backup
        const fileName = file.name.toLowerCase();
        const hasValidExtension = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.m4v'].some(ext => fileName.endsWith(ext));
        
        if (!allowedTypes.includes(file.type) && !hasValidExtension) {
            this.showError('Unsupported file format. Please select MP4, AVI, MOV, MKV, WebM, or M4V files.');
            return;
        }

        // Validate file size (10GB limit)
        const maxSize = 10 * 1024 * 1024 * 1024; // 10GB
        if (file.size > maxSize) {
            this.showError('File size exceeds 10GB limit.');
            return;
        }

        this.uploadFile(file);
    }

    // Upload file to server
    async uploadFile(file) {
        const formData = new FormData();
        formData.append('video', file);

        // Show progress
        this.progressContainer.style.display = 'block';
        this.progressFill.style.width = '0%';
        this.progressText.textContent = 'Uploading...';

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Upload failed');
            }

            const result = await response.json();
            this.currentMetadata = result.data;
            
            this.progressFill.style.width = '100%';
            this.progressText.textContent = 'Upload complete!';
            
            // Load video in player
            this.loadVideoPlayer();
            
        } catch (error) {
            this.showError(`Upload failed: ${error.message}`);
        }
    }

    // Load video in player
    loadVideoPlayer() {
        if (this.currentMetadata && this.currentMetadata.filename) {
            // Check for AV1 codec compatibility
            const isAV1 = this.currentMetadata.video_codec === 'av1';
            
            if (isAV1 && !this.checkAV1Support()) {
                // Show fallback for AV1 videos
                this.showAV1Fallback();
            } else {
                // Properly encode the filename for the URL
                const encodedFilename = encodeURIComponent(this.currentMetadata.filename);
                this.videoPlayer.src = `/api/preview/${encodedFilename}`;
                console.log('Loading video:', this.videoPlayer.src);
                
                // Add error handler for video loading
                this.videoPlayer.addEventListener('error', (e) => {
                    console.error('Video loading error:', e);
                    this.showVideoError('Video preview not supported by your browser.');
                });
                
                this.videoPlayer.addEventListener('loadedmetadata', () => {
                    console.log('Video loaded successfully');
                });
            }
        }
        
        this.displayVideoMetadata();
        this.showSection('player-section');
    }

    // Display video metadata
    displayVideoMetadata() {
        if (!this.currentMetadata) return;

        const duration = this.formatDuration(this.currentMetadata.duration / 1000000000); // Convert from nanoseconds
        const size = this.formatFileSize(this.currentMetadata.size);
        
        this.videoInfo.innerHTML = `
            <h3>Video Information</h3>
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">Filename:</span>
                    <span class="info-value">${this.currentMetadata.filename}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Duration:</span>
                    <span class="info-value">${duration}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Resolution:</span>
                    <span class="info-value">${this.currentMetadata.resolution || 'N/A'}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Format:</span>
                    <span class="info-value">${this.currentMetadata.format}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Size:</span>
                    <span class="info-value">${size}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Video Codec:</span>
                    <span class="info-value">${this.currentMetadata.video_codec || 'N/A'}</span>
                </div>
            </div>
        `;
    }

    // Initialize timeline after video loads
    initializeTimeline() {
        if (!this.currentMetadata) return;
        
        this.timelineDuration = this.currentMetadata.duration / 1000000000; // Convert from nanoseconds to seconds
        this.startTime = 0;
        this.endTime = this.timelineDuration;
        
        this.updateTimelineMarkers();
        this.updateTimeDisplay();
        this.cutButton.disabled = false;
    }

    // Timeline drag handling
    startDrag(e) {
        e.preventDefault();
        this.isDragging = true;
        this.dragTarget = e.target;
        document.body.style.cursor = 'grabbing';
    }

    handleDrag(e) {
        if (!this.isDragging || !this.dragTarget) return;
        
        const timelineRect = this.timeline.getBoundingClientRect();
        const x = e.clientX - timelineRect.left;
        const percentage = Math.max(0, Math.min(1, x / timelineRect.width));
        const time = percentage * this.timelineDuration;
        
        if (this.dragTarget === this.startMarker) {
            this.startTime = Math.min(time, this.endTime - 1); // Keep at least 1 second gap
        } else if (this.dragTarget === this.endMarker) {
            this.endTime = Math.max(time, this.startTime + 1); // Keep at least 1 second gap
        }
        
        this.updateTimelineMarkers();
        this.updateTimeDisplay();
    }

    stopDrag() {
        if (this.isDragging) {
            this.isDragging = false;
            this.dragTarget = null;
            document.body.style.cursor = 'default';
        }
    }

    // Timeline click handler
    handleTimelineClick(e) {
        if (this.isDragging) return;
        
        const timelineRect = this.timeline.getBoundingClientRect();
        const x = e.clientX - timelineRect.left;
        const percentage = x / timelineRect.width;
        const time = percentage * this.timelineDuration;
        
        // Determine which marker to move based on proximity
        const startDistance = Math.abs(time - this.startTime);
        const endDistance = Math.abs(time - this.endTime);
        
        if (startDistance < endDistance) {
            this.startTime = Math.max(0, Math.min(time, this.endTime - 1));
        } else {
            this.endTime = Math.min(this.timelineDuration, Math.max(time, this.startTime + 1));
        }
        
        this.updateTimelineMarkers();
        this.updateTimeDisplay();
    }

    // Update timeline marker positions
    updateTimelineMarkers() {
        if (!this.timelineDuration || this.timelineDuration === 0) return;
        
        const startPercentage = Math.max(0, Math.min(100, (this.startTime / this.timelineDuration) * 100));
        const endPercentage = Math.max(0, Math.min(100, (this.endTime / this.timelineDuration) * 100));
        
        // Account for marker width and timeline padding
        const timelineWidth = this.timeline.clientWidth;
        const markerWidth = 20; // matches CSS
        const padding = 10; // matches CSS
        const usableWidth = timelineWidth - (2 * padding) - markerWidth;
        
        const startPos = padding + (startPercentage / 100) * usableWidth;
        const endPos = padding + (endPercentage / 100) * usableWidth;
        
        this.startMarker.style.left = `${startPos}px`;
        this.endMarker.style.left = `${endPos}px`;
        
        // Update selection area
        this.timelineSelection.style.left = `${startPos + markerWidth/2}px`;
        this.timelineSelection.style.width = `${Math.max(0, endPos - startPos)}px`;
    }

    // Update time display
    updateTimeDisplay() {
        this.startTimeInput.value = this.formatDuration(this.startTime);
        this.endTimeInput.value = this.formatDuration(this.endTime);
        this.cutDuration.textContent = this.formatDuration(this.endTime - this.startTime);
    }

    // Video progress update
    updateVideoProgress() {
        if (this.videoPlayer && this.currentTimeDisplay) {
            const currentTime = this.videoPlayer.currentTime;
            this.currentTimeDisplay.textContent = this.formatDuration(currentTime);
            
            // Update timeline position indicator if desired
            if (this.timelineDuration > 0) {
                const percentage = (currentTime / this.timelineDuration) * 100;
                // Could add a current position indicator on timeline here
            }
        }
    }

    // Cut video
    async cutVideo() {
        console.log('Cut video called');
        
        if (!this.currentMetadata) {
            console.error('No metadata available');
            this.showError('No video metadata available. Please upload a video first.');
            return;
        }
        
        console.log('Cut parameters:', {
            filename: this.currentMetadata.filename,
            startTime: this.startTime,
            endTime: this.endTime,
            duration: this.timelineDuration
        });
        
        this.showSection('processing-section');
        
        try {
            const requestBody = {
                filename: this.currentMetadata.filename,
                start_time: Math.floor(this.startTime * 1000000000), // Convert to nanoseconds
                end_time: Math.floor(this.endTime * 1000000000)
            };
            
            console.log('Sending cut request:', requestBody);
            
            const response = await fetch('/api/cut', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            console.log('Cut response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Cut response error:', errorText);
                throw new Error(`Server error: ${response.status} - ${errorText}`);
            }
            
            const result = await response.json();
            console.log('Cut result:', result);
            
            if (result.success && result.data) {
                this.outputFilename = result.data.output_filename;
                this.showSection('download-section');
            } else {
                throw new Error(result.message || 'Cut operation failed');
            }
            
        } catch (error) {
            console.error('Cut error:', error);
            this.showError(`Cut operation failed: ${error.message}`);
        }
    }

    // Download video
    downloadVideo() {
        if (this.outputFilename) {
            window.open(`/api/download/${this.outputFilename}`, '_blank');
        }
    }

    // Utility functions
    showSection(sectionId) {
        Object.values(this.sections).forEach(section => {
            section.style.display = 'none';
        });
        document.getElementById(sectionId).style.display = 'block';
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.showSection('error-section');
    }

    resetApp() {
        // Reset all state
        this.currentMetadata = null;
        this.outputFilename = null;
        this.startTime = 0;
        this.endTime = 0;
        this.timelineDuration = 0;
        
        // Reset UI elements
        this.videoInput.value = '';
        this.progressContainer.style.display = 'none';
        this.cutButton.disabled = true;
        
        // Show upload section
        this.showSection('upload-section');
    }

    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    formatFileSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }

    // Check if browser supports AV1 codec
    checkAV1Support() {
        const video = document.createElement('video');
        return video.canPlayType('video/mp4; codecs="av01.0.05M.08"') !== '' ||
               video.canPlayType('video/webm; codecs="av01.0.05M.08"') !== '';
    }

    // Show AV1 fallback message
    showAV1Fallback() {
        const videoContainer = this.videoPlayer.parentElement;
        videoContainer.innerHTML = `
            <div class="video-fallback">
                <div class="fallback-icon">🎬</div>
                <h3>AV1 Video Detected</h3>
                <p>Your browser doesn't support AV1 video playback for preview.</p>
                <p><strong>Don't worry!</strong> You can still cut this video using the timeline below.</p>
                <div class="fallback-info">
                    <p><strong>Video Duration:</strong> ${this.formatDuration(this.currentMetadata.duration / 1000000000)}</p>
                    <p><strong>Resolution:</strong> ${this.currentMetadata.resolution}</p>
                </div>
                <p class="fallback-note">The video cutting will work perfectly even without preview!</p>
            </div>
        `;
    }

    // Show video error message
    showVideoError(message) {
        const videoContainer = this.videoPlayer.parentElement;
        videoContainer.innerHTML = `
            <div class="video-fallback error">
                <div class="fallback-icon">⚠️</div>
                <h3>Video Preview Error</h3>
                <p>${message}</p>
                <p>You can still use the timeline below to cut your video.</p>
            </div>
        `;
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.videoCutterApp = new VideoCutterApp();
});