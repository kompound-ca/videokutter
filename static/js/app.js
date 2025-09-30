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
        this.sessionID = null;
        this.sessionTimer = null;
        
        // JWT Session Management
        this.jwtToken = null;
        this.userID = null;
        this.sessionReady = false; // Track if session is initialized
        
        this.initializeElements();
        this.bindEvents();
        this.showInitializing();
        this.initializeSession();
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
        
        // Timer elements (will be dynamically set)
        this.timerElement = null;
        this.timerMessage = null;
        this.timerCountdown = null;

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

    // JWT Session Management Methods
    async initializeSession() {
        // Try to load existing token from localStorage
        this.jwtToken = localStorage.getItem('jwt_token');
        this.userID = localStorage.getItem('user_id');
        
        if (this.jwtToken && this.userID) {
            console.log('Found existing JWT token for user:', this.userID);
            // Use existing token (browser fingerprint should be the same)
            this.sessionReady = true;
            this.restoreUploadSection();
        } else {
            console.log('No existing token found, requesting new session');
            await this.requestNewSession();
        }
    }
    
    async requestNewSession() {
        try {
            const response = await fetch('/api/session/init', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Session initialization failed: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success && result.data) {
                this.jwtToken = result.data.token;
                this.userID = result.data.user_id;
                
                // Store in localStorage for persistence
                localStorage.setItem('jwt_token', this.jwtToken);
                localStorage.setItem('user_id', this.userID);
                
                console.log('New JWT session initialized for user:', this.userID);
                this.sessionReady = true;
                this.restoreUploadSection();
            } else {
                throw new Error('Invalid session response');
            }
        } catch (error) {
            console.error('Failed to initialize session:', error);
            this.showError('Failed to initialize session. Please refresh the page.');
        }
    }
    
    makeAuthenticatedRequest(url, options = {}) {
        if (!this.jwtToken) {
            console.error('JWT token not available, session ready:', this.sessionReady);
            throw new Error('No JWT token available. Please refresh the page.');
        }
        
        const headers = {
            'Authorization': `Bearer ${this.jwtToken}`,
            ...options.headers
        };
        
        return fetch(url, {
            ...options,
            headers
        });
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
        // Check if session is ready
        if (!this.sessionReady || !this.jwtToken) {
            this.showError('Session not ready. Please wait for authentication to complete.');
            return;
        }
        
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

    // Upload file using chunked upload with parallel streams
    async uploadFile(file) {
        // Show progress
        this.progressContainer.style.display = 'block';
        this.progressFill.style.width = '0%';
        this.progressText.textContent = 'Initializing upload...';

        try {
            // Initialize chunked upload
            const chunkSize = 5 * 1024 * 1024; // 5MB chunks
            const totalChunks = Math.ceil(file.size / chunkSize);
            
            const initResponse = await this.makeAuthenticatedRequest('/api/upload/init', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: file.name,
                    file_size: file.size,
                    chunk_size: chunkSize
                })
            });
            
            const initResult = await initResponse.json();
            if (!initResult.success) {
                throw new Error(initResult.message);
            }
            
            const uploadID = initResult.data.upload_id;
            this.currentUploadID = uploadID;
            
            // Start chunked upload with parallel streams
            await this.uploadChunksParallel(file, uploadID, chunkSize, totalChunks);
            
            // Complete upload
            const completeResponse = await this.makeAuthenticatedRequest('/api/upload/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ upload_id: uploadID })
            });
            
            const completeResult = await completeResponse.json();
            if (!completeResult.success) {
                throw new Error(completeResult.message);
            }
            
            // Store upload response data
            this.uploadResponse = completeResult.data;
            this.sessionID = completeResult.data.session_id;
            console.log('Upload complete - Session ID:', this.sessionID);
            
            this.progressFill.style.width = '100%';
            this.progressText.textContent = 'Upload complete! Loading preview...';
            
            // Show player section immediately for better UX
            this.showSection('player-section');
            
            // Load video player first (fast)
            this.loadVideoPlayerImmediate();
            
            // Fetch metadata in background after a short delay (slow)
            setTimeout(() => {
                this.fetchVideoMetadata(); // Don't await - run in parallel
            }, 100); // Small delay to let video start loading first
            
            // Start timer for cutting phase
            setTimeout(() => {
                this.startSessionTimer('cut');
            }, 500);
            
        } catch (error) {
            this.progressContainer.style.display = 'none';
            this.showError(`Upload failed: ${error.message}`);
        }
    }

    // Upload chunks in parallel with resume capability
    async uploadChunksParallel(file, uploadID, chunkSize, totalChunks) {
        const maxParallelUploads = 3;
        const uploadedChunks = new Set();
        let uploadedCount = 0;
        
        // Check for existing uploads (resume capability)
        try {
            const statusResponse = await this.makeAuthenticatedRequest(`/api/upload/status/${uploadID}`);
            if (statusResponse.ok) {
                const statusResult = await statusResponse.json();
                if (statusResult.success) {
                    // Mark already uploaded chunks
                    const missingChunks = statusResult.data.missing_chunks || [];
                    for (let i = 0; i < totalChunks; i++) {
                        if (!missingChunks.includes(i)) {
                            uploadedChunks.add(i);
                            uploadedCount++;
                        }
                    }
                    console.log(`Resuming upload: ${uploadedCount}/${totalChunks} chunks already uploaded`);
                }
            }
        } catch (e) {
            console.log('No existing upload session found, starting fresh');
        }
        
        const updateProgress = () => {
            const progress = Math.round((uploadedCount / totalChunks) * 100);
            this.progressFill.style.width = `${progress}%`;
            this.progressText.textContent = `Uploading... ${progress}% (${uploadedCount}/${totalChunks} chunks)`;
        };
        
        updateProgress();
        
        // Create upload queue
        const chunksToUpload = [];
        for (let i = 0; i < totalChunks; i++) {
            if (!uploadedChunks.has(i)) {
                chunksToUpload.push(i);
            }
        }
        
        // Upload chunks with parallel streams
        const uploadPromises = [];
        let chunkIndex = 0;
        
        const uploadChunk = async (index) => {
            const start = index * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = file.slice(start, end);
            
            const formData = new FormData();
            formData.append('upload_id', uploadID);
            formData.append('chunk_index', index.toString());
            formData.append('chunk', chunk, `chunk_${index}`);
            
            const response = await this.makeAuthenticatedRequest('/api/upload/chunk', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(`Chunk ${index} failed: ${result.message}`);
            }
            
            uploadedChunks.add(index);
            uploadedCount++;
            updateProgress();
            
            return result;
        };
        
        // Process chunks with concurrency limit
        while (chunkIndex < chunksToUpload.length) {
            const currentBatch = [];
            
            // Create batch of parallel uploads
            for (let i = 0; i < maxParallelUploads && chunkIndex < chunksToUpload.length; i++) {
                const currentChunkIndex = chunksToUpload[chunkIndex];
                currentBatch.push(uploadChunk(currentChunkIndex));
                chunkIndex++;
            }
            
            // Wait for current batch to complete
            await Promise.all(currentBatch);
        }
        
        console.log(`Upload completed: ${uploadedCount}/${totalChunks} chunks uploaded`);
    }

    // Fetch video metadata separately for better performance
    async fetchVideoMetadata() {
        if (!this.uploadResponse || !this.uploadResponse.filename) {
            throw new Error('No filename available for metadata extraction');
        }
        
        try {
            const response = await this.makeAuthenticatedRequest(`/api/metadata/${encodeURIComponent(this.uploadResponse.filename)}`);
            
            if (!response.ok) {
                throw new Error('Failed to fetch metadata');
            }
            
            const result = await response.json();
            this.currentMetadata = result.data;
            
            console.log('Full metadata loaded:', this.currentMetadata);
            
            // Update display with complete metadata
            this.displayVideoMetadata();
            
            // Update timeline if duration differs from browser metadata
            if (this.currentMetadata.duration) {
                const serverDuration = this.currentMetadata.duration / 1000000000; // Convert from nanoseconds
                if (Math.abs(this.timelineDuration - serverDuration) > 1) {
                    console.log('Updating timeline with server duration:', serverDuration);
                    this.timelineDuration = serverDuration;
                    this.endTime = serverDuration;
                    this.updateTimelineMarkers();
                    this.updateTimeDisplay();
                }
            }
            
        } catch (error) {
            console.error('Metadata fetch error:', error);
            // Use basic metadata from upload response as fallback
            this.currentMetadata = {
                filename: this.uploadResponse.filename,
                size: this.uploadResponse.size,
                uploaded: true,
                duration: 0, // Will need to be determined later
                format: 'Unknown'
            };
            
            // Show error state with fallback info
            this.showFallbackWithError('Failed to extract video metadata. You can still try to cut the video.');
        }
    }

    // Show fallback with error message
    showFallbackWithError(message) {
        const videoContainer = this.videoPlayer ? this.videoPlayer.parentElement : document.querySelector('.video-container');
        if (!videoContainer) {
            console.error('Video container not found');
            this.showError(message);
            return;
        }
        
        videoContainer.innerHTML = `
            <div class="video-fallback error">
                <div class="fallback-icon">⚠️</div>
                <h3>Metadata Error</h3>
                <p>${message}</p>
                <div class="fallback-info">
                    <p><strong>File:</strong> ${this.uploadResponse ? this.uploadResponse.filename : 'Unknown'}</p>
                    <p><strong>Size:</strong> ${this.uploadResponse ? this.formatFileSize(this.uploadResponse.size) : 'Unknown'}</p>
                </div>
                <p>You can still try to cut the video even without complete metadata.</p>
            </div>
        `;
        
        // Try to initialize timeline with basic info if we have upload response
        if (this.uploadResponse && this.currentMetadata) {
            this.currentMetadata.duration = 3600000000000; // Default 1 hour in nanoseconds
            this.initializeTimeline();
        }
    }

    // Refresh player after metadata is loaded
    refreshPlayerWithMetadata() {
        if (!this.currentMetadata || !this.currentMetadata.filename) {
            return;
        }
        
        // Reset video container to original structure
        const videoContainer = this.videoPlayer.parentElement;
        videoContainer.innerHTML = `
            <video id="video-player" controls preload="metadata" style="width: 100%; border-radius: 8px;">
                <p>Your browser does not support video playback.</p>
            </video>
            <div class="video-info-overlay">
                <span id="current-time-display">00:00:00</span>
            </div>
        `;
        
        // Re-initialize player elements
        this.videoPlayer = document.getElementById('video-player');
        this.currentTimeDisplay = document.getElementById('current-time-display');
        
        // Re-bind video events
        this.videoPlayer.addEventListener('loadedmetadata', this.initializeTimeline.bind(this));
        this.videoPlayer.addEventListener('timeupdate', this.updateVideoProgress.bind(this));
        
        // Check for AV1 codec compatibility
        const isAV1 = this.currentMetadata.video_codec === 'av1';
        
        if (isAV1 && !this.checkAV1Support()) {
            // Show fallback for AV1 videos
            this.showAV1Fallback();
        } else {
            // Load video
            const encodedFilename = encodeURIComponent(this.currentMetadata.filename);
            this.videoPlayer.src = `/api/preview/${encodedFilename}?token=${this.jwtToken}`;
            console.log('Loading video:', this.videoPlayer.src);
            
            // Add error handler for video loading
            this.videoPlayer.addEventListener('error', (e) => {
                console.error('Video loading error:', e);
                const original = this.currentMetadata ? this.currentMetadata.filename : '';
                let message = 'Video preview not supported by your browser. You can still cut the video below.';
                
                // Show specific message for MOV files
                if (original && /\.mov$/i.test(original)) {
                    message = 'MOV preview not supported in this browser. You can still cut the video using the timeline below.';
                }
                
                this.showSimpleError(message);
            });
            
            this.videoPlayer.addEventListener('loadedmetadata', () => {
                console.log('Video loaded successfully');
            });
        }
        
        // Update video info display
        this.displayVideoMetadata();
    }

    // Load video player immediately after upload (fast)
    loadVideoPlayerImmediate() {
        if (!this.uploadResponse || !this.uploadResponse.filename) {
            console.error('No filename available for immediate loading');
            return;
        }
        
        // Load video preview immediately using upload response data
        const encodedFilename = encodeURIComponent(this.uploadResponse.filename);
        this.videoPlayer.src = `/api/preview/${encodedFilename}?token=${this.jwtToken}`;
        this.videoPlayer.preload = 'metadata'; // Start loading metadata immediately
        console.log('Loading video preview immediately:', this.videoPlayer.src);
        
        // Add error handler for video loading
        this.videoPlayer.addEventListener('error', (e) => {
            console.error('Video loading error:', e);
            const original = this.uploadResponse ? this.uploadResponse.filename : '';
            let message = 'Video preview not supported by your browser. You can still cut the video below.';
            
            // Show specific message for MOV files
            if (original && /\.mov$/i.test(original)) {
                message = 'MOV preview not supported in this browser. You can still cut the video using the timeline below.';
            }
            
            this.showSimpleError(message);
        });
        
        this.videoPlayer.addEventListener('loadedmetadata', () => {
            console.log('Video preview loaded successfully');
            
            // Hide progress container since video is loading
            this.progressContainer.style.display = 'none';
            
            // Try to initialize timeline with browser metadata
            this.initializeTimelineFromVideo();
        });
        
        // Show basic upload info immediately
        this.displayUploadInfo();
    }
    
    // Display basic upload info while metadata loads
    displayUploadInfo() {
        if (!this.uploadResponse) return;
        
        const size = this.formatFileSize(this.uploadResponse.size);
        
        this.videoInfo.innerHTML = `
            <h3>Video Information</h3>
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">Filename:</span>
                    <span class="info-value">${this.uploadResponse.filename}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Size:</span>
                    <span class="info-value">${size}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Status:</span>
                    <span class="info-value">Loading metadata... <span class="loading-dots">...</span></span>
                </div>
            </div>
        `;
    }
    
    // Initialize timeline using browser video metadata (fast)
    initializeTimelineFromVideo() {
        if (!this.videoPlayer || !this.videoPlayer.duration) {
            console.log('Video duration not available yet, waiting for full metadata');
            return;
        }
        
        console.log('Initializing timeline from video metadata');
        
        // Use browser's metadata for immediate timeline setup
        this.timelineDuration = this.videoPlayer.duration;
        this.startTime = 0;
        this.endTime = this.timelineDuration;
        
        // Enable cut button early
        this.cutButton.disabled = false;
        
        // Initialize timeline UI
        this.updateTimelineMarkers();
        this.updateTimeDisplay();
        
        console.log('Timeline initialized with duration:', this.timelineDuration);
    }
    
    // Load video in player (legacy method - kept for compatibility)
    loadVideoPlayer() {
        // Show player section first
        this.showSection('player-section');
        
        // Check if we have full metadata
        if (!this.currentMetadata || !this.currentMetadata.duration) {
            // Show loading state while metadata loads
            this.showMetadataLoading();
            return;
        }
        
        if (this.currentMetadata && this.currentMetadata.filename) {
            // Load video preview
            const encodedFilename = encodeURIComponent(this.currentMetadata.filename);
            this.videoPlayer.src = `/api/preview/${encodedFilename}?token=${this.jwtToken}`;
            console.log('Loading video preview:', this.videoPlayer.src);
            
            // Add error handler for video loading
            this.videoPlayer.addEventListener('error', (e) => {
                console.error('Video loading error:', e);
                this.showSimpleError('Video format may not be supported by your browser.');
            });
            
            this.videoPlayer.addEventListener('loadedmetadata', () => {
                console.log('Video preview loaded successfully');
            });
        }
        
        this.displayVideoMetadata();
    }

    // Show loading state for metadata
    showMetadataLoading() {
        const videoContainer = this.videoPlayer.parentElement;
        videoContainer.innerHTML = `
            <div class="video-fallback">
                <div class="spinner"></div>
                <h3>Processing Video...</h3>
                <p>Extracting video metadata and preparing preview...</p>
                <p class="fallback-note">This may take a moment for large videos.</p>
            </div>
        `;
        
        // Show basic file info
        if (this.uploadResponse) {
            this.videoInfo.innerHTML = `
                <h3>Video Information</h3>
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">Filename:</span>
                        <span class="info-value">${this.uploadResponse.filename}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Size:</span>
                        <span class="info-value">${this.formatFileSize(this.uploadResponse.size)}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Status:</span>
                        <span class="info-value">Loading metadata...</span>
                    </div>
                </div>
            `;
        }
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
        if (!this.currentMetadata) {
            console.error('No metadata for timeline initialization');
            return;
        }
        
        this.timelineDuration = this.currentMetadata.duration / 1000000000; // Convert from nanoseconds to seconds
        this.startTime = 0;
        this.endTime = this.timelineDuration;
        
        // Timeline initialized
        
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
        // Start time updated
        } else if (this.dragTarget === this.endMarker) {
            this.endTime = Math.max(time, this.startTime + 1); // Keep at least 1 second gap
        // End time updated
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
        if (!this.timelineDuration || this.timelineDuration === 0) {
            console.warn('Cannot update timeline markers: no duration set');
            return;
        }
        
        const startPercentage = Math.max(0, Math.min(100, (this.startTime / this.timelineDuration) * 100));
        const endPercentage = Math.max(0, Math.min(100, (this.endTime / this.timelineDuration) * 100));
        
        // Timeline markers updated
        
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
            
            const response = await this.makeAuthenticatedRequest('/api/cut', {
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
                // Start timer for download phase
                this.startSessionTimer('download');
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
            const downloadUrl = `/api/download/${this.outputFilename}?token=${this.jwtToken}`;
            window.open(downloadUrl, '_blank');
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
    
    showInitializing() {
        // Add a temporary initializing message to upload section
        const uploadSection = this.sections.upload;
        uploadSection.innerHTML = `
            <h2>Upload Video</h2>
            <div class="upload-area initializing" style="justify-content: center; align-items: center; height: 200px;">
                <div class="upload-content">
                    <div class="spinner"></div>
                    <p style="margin-top: 20px;">Initializing secure session...</p>
                    <p class="upload-info">Please wait while we set up authentication.</p>
                </div>
            </div>
        `;
        this.showSection('upload-section');
    }
    
    restoreUploadSection() {
        // Restore original upload section HTML
        const uploadSection = this.sections.upload;
        uploadSection.innerHTML = `
            <h2>Upload Video</h2>
            <div class="upload-area" id="upload-area">
                <div class="upload-content">
                    <div class="upload-icon">📁</div>
                    <p>Drag & drop your video here or <span class="browse-link">browse files</span></p>
                    <p class="upload-info">Supported formats: MP4, AVI, MOV, MKV, WebM, M4V (max 10GB)</p>
                </div>
                <input type="file" id="video-input" accept=".mp4,.avi,.mov,.mkv,.webm,.m4v" hidden>
            </div>
            <div id="upload-progress" class="progress-container" style="display: none;">
                <div class="progress-bar">
                    <div class="progress-fill" id="progress-fill"></div>
                </div>
                <p id="progress-text">Uploading...</p>
            </div>
        `;
        
        // Re-initialize elements after DOM change
        this.uploadArea = document.getElementById('upload-area');
        this.videoInput = document.getElementById('video-input');
        this.progressContainer = document.getElementById('upload-progress');
        this.progressFill = document.getElementById('progress-fill');
        this.progressText = document.getElementById('progress-text');
        
        // Re-bind upload events
        this.uploadArea.addEventListener('click', () => this.videoInput.click());
        this.uploadArea.addEventListener('dragover', this.handleDragOver.bind(this));
        this.uploadArea.addEventListener('dragleave', this.handleDragLeave.bind(this));
        this.uploadArea.addEventListener('drop', this.handleDrop.bind(this));
        this.videoInput.addEventListener('change', this.handleFileSelect.bind(this));
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

    // Simple error message for preview issues
    showSimpleError(message) {
        const videoContainer = this.videoPlayer ? this.videoPlayer.parentElement : document.querySelector('.video-container');
        if (!videoContainer) {
            console.error('Video container not found');
            this.showError(message);
            return;
        }
        videoContainer.innerHTML = `
            <div class="video-fallback">
                <div class="fallback-icon">📺</div>
                <h3>Video Preview</h3>
                <p>${message}</p>
                <p class="fallback-note">You can still use the timeline below to cut your video.</p>
            </div>
        `;
        
        // Initialize timeline even without video preview
        this.initializeTimeline();
    }
    
    // Unified Session Timer Methods
    async startSessionTimer(phase) {
        console.log(`Starting session timer for ${phase} phase with sessionID:`, this.sessionID);
        
        if (!this.sessionID) {
            console.warn('No session ID available for session timer');
            return;
        }
        
        // Stop any existing timer
        this.stopSessionTimer();
        
        // Show and update the timer immediately
        this.showTimer(phase);
        await this.updateTimer();
        
        // Start timer update interval
        this.sessionTimer = setInterval(async () => {
            await this.updateTimer();
        }, 1000);
    }
    
    stopSessionTimer() {
        if (this.sessionTimer) {
            clearInterval(this.sessionTimer);
            this.sessionTimer = null;
        }
        this.hideTimer();
    }
    
    showTimer(phase) {
        // Determine which section to show timer in
        const targetSection = phase === 'cut' ? 'player-section' : 'download-section';
        const section = document.getElementById(targetSection);
        
        if (!section) return;
        
        // Remove any existing timer
        this.hideTimer();
        
        // Create timer element
        const timerElement = document.createElement('div');
        timerElement.className = 'session-timer unified-timer';
        timerElement.id = 'unified-timer';
        
        // Set up timer message based on phase
        const message = phase === 'cut' 
            ? 'You have {TIME} remaining to cut your video'
            : 'You have {TIME} remaining to download your video';
        
        // Create simple timer HTML
        timerElement.innerHTML = `
            <div class="timer-content">
                <p class="timer-message">${message.replace('{TIME}', '<span class="countdown-time">5:00</span>')}</p>
            </div>
        `;
        
        // Insert timer at the beginning of the section
        section.insertBefore(timerElement, section.firstElementChild.nextElementSibling);
        
        // Store references for easy updates
        this.timerElement = timerElement;
        this.timerMessage = timerElement.querySelector('.timer-message');
        this.timerCountdown = timerElement.querySelector('.countdown-time');
    }
    
    hideTimer() {
        // Remove dynamic timer if it exists
        const existingTimer = document.getElementById('unified-timer');
        if (existingTimer) {
            existingTimer.remove();
        }
        
        // Clear references
        this.timerElement = null;
        this.timerMessage = null;
        this.timerCountdown = null;
    }
    
    async updateTimer() {
        if (!this.sessionID || !this.timerCountdown) {
            return;
        }
        
        try {
            const response = await this.makeAuthenticatedRequest(`/api/cleanup/session/${this.sessionID}/time-remaining`);
            const result = await response.json();
            
            if (result.success && result.data) {
                const remainingSeconds = result.data.remaining_seconds;
                const phase = result.data.phase;
                
                if (remainingSeconds <= 0) {
                    this.onTimerExpired(phase);
                    return;
                }
                
                // Update countdown display
                this.timerCountdown.textContent = this.formatTime(remainingSeconds);
                
            } else {
                console.warn('Failed to get session time remaining:', result.error);
            }
        } catch (error) {
            console.error('Error updating timer:', error);
        }
    }
    
    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
    
    onTimerExpired(phase) {
        this.stopSessionTimer();
        
        const message = phase === 'cut'
            ? 'Your upload session has expired. The video has been automatically deleted. Please upload a new video.'
            : 'Your download session has expired. The video file has been automatically deleted. Please upload a new video.';
        
        console.log(`Session expired - ${phase} phase`);
        this.showError(message);
    }
    
    async resetApp() {
        // Stop any running timers
        this.stopSessionTimer();
        
        // Reset all state
        this.currentMetadata = null;
        this.outputFilename = null;
        this.sessionID = null;
        this.startTime = 0;
        this.endTime = 0;
        this.timelineDuration = 0;
        
        // Reset UI elements
        this.videoInput.value = '';
        this.progressContainer.style.display = 'none';
        this.cutButton.disabled = true;
        
        // Reset download button
        if (this.downloadButton) {
            this.downloadButton.disabled = false;
            this.downloadButton.textContent = 'Download Cut Video';
        }
        
        // Clear stored JWT token to force fresh session
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('user_id');
        this.jwtToken = null;
        this.userID = null;
        this.sessionReady = false;
        
        // Show initializing state
        this.showInitializing();
        
        // Get a fresh JWT session (this will show upload section when complete)
        await this.requestNewSession();
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.videoCutterApp = new VideoCutterApp();
});