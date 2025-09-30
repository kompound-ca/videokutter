// Video Cutter App
class VideoCutterApp {
    constructor() {
        // Remove preload class ASAP to reveal content once DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                document.documentElement.classList.remove('preload');
            });
        } else {
            document.documentElement.classList.remove('preload');
        }

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
        
        // Session state persistence
        this.sessionState = {
            phase: 'upload', // upload, player, processing, download
            filename: null,
            metadata: null,
            startTime: 0,
            endTime: 0,
            outputFilename: null,
            sessionID: null
        };
        
        this.initializeElements();
        this.bindEvents();
        this.deferredInitialization();
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
        this.timeline.addEventListener('mousemove', this.handleTimelineHover.bind(this));
        this.timeline.addEventListener('mouseleave', this.hideTimelineTooltip.bind(this));
        document.addEventListener('mousemove', this.handleDrag.bind(this));
        document.addEventListener('mouseup', this.stopDrag.bind(this));
        
        // Initialize timeline tooltip
        this.initializeTimelineTooltip();

        // Video player events
        this.videoPlayer.addEventListener('loadedmetadata', this.initializeTimeline.bind(this));
        this.videoPlayer.addEventListener('timeupdate', this.updateVideoProgress.bind(this));

        // Button events
        this.cutButton.addEventListener('click', this.cutVideo.bind(this));
        this.downloadButton.addEventListener('click', this.downloadVideo.bind(this));
        this.newVideoButton.addEventListener('click', async () => await this.resetApp());
        this.retryButton.addEventListener('click', async () => await this.resetApp());
    }

    // JWT Session Management Methods
    async initializeSession() {
        // Try to load existing token from localStorage
        this.jwtToken = localStorage.getItem('jwt_token');
        this.userID = localStorage.getItem('user_id');
        
        // Try to restore session state
        this.restoreSessionState();
        
        if (this.jwtToken && this.userID) {
            console.log('Found existing JWT token for user:', this.userID);
            // Use existing token (browser fingerprint should be the same)
            this.sessionReady = true;
            
            // Restore previous session or show upload
            if (this.sessionState.phase !== 'upload' && this.sessionState.filename) {
                this.restoreSessionWorkflow();
            } else {
                this.restoreUploadSection();
            }
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
            this.progressText.innerHTML = `
                <span class="status-indicator success">
                    <div class="status-dot"></div>
                    Upload complete! Loading preview...
                </span>
            `;
            
            // Show player section with transition message
            this.showSection('player-section', 'Loading video preview...');
            
            // Update session phase
            this.updateSessionPhase('player');
            
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

    // Upload chunks in parallel with resume capability (optimized for Azure VM)
    async uploadChunksParallel(file, uploadID, chunkSize, totalChunks) {
        const maxParallelUploads = 4; // Reduced from 3 to balance speed vs server load
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
            
            // Enhanced progress display with status indicator
            this.progressText.innerHTML = `
                <span class="status-indicator loading">
                    <div class="status-dot"></div>
                    Uploading... ${progress}% (${uploadedCount}/${totalChunks} chunks)
                </span>
            `;
            
            // Add progress milestones
            if (progress === 25 || progress === 50 || progress === 75) {
                this.showTransitionMessage(`Upload ${progress}% complete`);
            }
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
        
        // Initialize timeline UI after a brief delay to ensure DOM is ready
        setTimeout(() => {
            this.initializeTimelineElements();
            this.updateTimelineMarkers();
            this.updateTimeDisplay();
            
            // Enable cut button after timeline is ready
            if (this.cutButton) {
                this.cutButton.disabled = false;
            }
        }, 100);
        
        console.log('Timeline initialized with duration:', this.timelineDuration);
    }
    
    // Ensure timeline elements are properly initialized
    initializeTimelineElements() {
        // Re-get timeline elements in case they were dynamically created
        this.timeline = document.getElementById('timeline');
        this.startMarker = document.getElementById('start-marker');
        this.endMarker = document.getElementById('end-marker');
        this.timelineSelection = document.getElementById('timeline-selection');
        
        if (!this.timeline || !this.startMarker || !this.endMarker || !this.timelineSelection) {
            console.error('Timeline elements not found during initialization:', {
                timeline: !!this.timeline,
                startMarker: !!this.startMarker,
                endMarker: !!this.endMarker,
                timelineSelection: !!this.timelineSelection
            });
            return false;
        }
        
        // Initialize tooltip if not already done
        if (!this.timelineTooltip) {
            this.initializeTimelineTooltip();
        }
        
        return true;
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

    // Timeline tooltip methods
    initializeTimelineTooltip() {
        if (!this.timeline) return;
        
        // Create tooltip element
        this.timelineTooltip = document.createElement('div');
        this.timelineTooltip.className = 'timeline-tooltip';
        this.timeline.appendChild(this.timelineTooltip);
    }
    
    handleTimelineHover(e) {
        if (this.isDragging || !this.timelineDuration || !this.timelineTooltip) return;
        
        const timelineRect = this.timeline.getBoundingClientRect();
        const x = e.clientX - timelineRect.left;
        const percentage = Math.max(0, Math.min(1, x / timelineRect.width));
        const time = percentage * this.timelineDuration;
        
        // Update tooltip content and position
        this.timelineTooltip.textContent = this.formatDuration(time);
        this.timelineTooltip.style.left = `${x}px`;
        this.timelineTooltip.classList.add('visible');
    }
    
    hideTimelineTooltip() {
        if (this.timelineTooltip) {
            this.timelineTooltip.classList.remove('visible');
        }
    }
    
    // Enhanced timeline drag handling with visual feedback
    startDrag(e) {
        e.preventDefault();
        this.isDragging = true;
        this.dragTarget = e.target;
        this.dragTarget.classList.add('dragging');
        document.body.style.cursor = 'grabbing';
        this.hideTimelineTooltip();
        
        // Add dragging state to timeline
        this.timeline.classList.add('dragging-active');
    }

    handleDrag(e) {
        if (!this.isDragging || !this.dragTarget) return;
        
        const timelineRect = this.timeline.getBoundingClientRect();
        const x = e.clientX - timelineRect.left;
        
        // Account for timeline padding and marker width when calculating time
        const trackPadding = 10;
        const markerWidth = 20;
        const usableWidth = timelineRect.width - (2 * trackPadding) - markerWidth;
        const adjustedX = Math.max(0, Math.min(usableWidth, x - trackPadding));
        const percentage = adjustedX / usableWidth;
        const time = percentage * this.timelineDuration;
        
        if (this.dragTarget === this.startMarker) {
            this.startTime = Math.max(0, Math.min(time, this.endTime - 1)); // Keep at least 1 second gap
            this.showTransitionFeedback('Start: ' + this.formatDuration(this.startTime));
        } else if (this.dragTarget === this.endMarker) {
            this.endTime = Math.min(this.timelineDuration, Math.max(time, this.startTime + 1)); // Keep at least 1 second gap
            this.showTransitionFeedback('End: ' + this.formatDuration(this.endTime));
        }
        
        // Debounce timeline updates for better performance
        this.debouncedTimelineUpdate();
    }

    stopDrag() {
        if (this.isDragging) {
            this.isDragging = false;
            if (this.dragTarget) {
                this.dragTarget.classList.remove('dragging');
                this.dragTarget = null;
            }
            document.body.style.cursor = 'default';
            
            // Remove dragging state from timeline
            if (this.timeline) {
                this.timeline.classList.remove('dragging-active');
            }
            
            // Final update to ensure accuracy
            this.updateTimelineMarkers();
            this.updateTimeDisplay();
        }
    }
    
    // Debounced timeline update for smoother performance
    debouncedTimelineUpdate() {
        if (this.timelineUpdateTimeout) {
            clearTimeout(this.timelineUpdateTimeout);
        }
        
        // Update markers immediately for visual feedback
        this.updateTimelineMarkers();
        
        // Debounce the display update which includes input fields and state saving
        this.timelineUpdateTimeout = setTimeout(() => {
            this.updateTimeDisplay();
        }, 100); // Reduced frequency for text updates and state saving
    }
    
    // Show quick feedback during interactions
    showTransitionFeedback(text) {
        // Remove existing feedback
        const existing = document.querySelector('.transition-feedback');
        if (existing) {
            existing.remove();
        }
        
        const feedback = document.createElement('div');
        feedback.className = 'transition-feedback';
        feedback.textContent = text;
        feedback.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 0.9rem;
            font-family: 'JetBrains Mono', monospace;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.2s ease;
            pointer-events: none;
        `;
        
        document.body.appendChild(feedback);
        
        requestAnimationFrame(() => {
            feedback.style.opacity = '0.9';
        });
        
        setTimeout(() => {
            feedback.style.opacity = '0';
            setTimeout(() => {
                if (document.body.contains(feedback)) {
                    document.body.removeChild(feedback);
                }
            }, 200);
        }, 800);
    }
    
    // Progress monitoring for video operations
    startProgressMonitoring() {
        if (this.progressMonitorInterval) {
            clearInterval(this.progressMonitorInterval);
        }
        
        this.progressPhase = 0;
        const phases = [
            'Analyzing video structure...',
            'Processing video segments...',
            'Optimizing output quality...',
            'Finalizing video file...'
        ];
        
        this.progressMonitorInterval = setInterval(() => {
            if (this.progressPhase < phases.length) {
                this.updateProgressPhase(phases[this.progressPhase]);
                this.progressPhase++;
            } else {
                // Stop the interval when we've shown all phases
                clearInterval(this.progressMonitorInterval);
                this.progressMonitorInterval = null;
            }
        }, 2500); // Slower phase transitions for better performance
    }
    
    updateProgressPhase(message) {
        const statusElement = document.querySelector('.processing-animation .status-indicator');
        if (statusElement) {
            statusElement.innerHTML = `
                <div class="status-dot"></div>
                ${message}
            `;
        }
    }
    
    stopProgressMonitoring() {
        if (this.progressMonitorInterval) {
            clearInterval(this.progressMonitorInterval);
            this.progressMonitorInterval = null;
        }
    }

    // Timeline click handler
    handleTimelineClick(e) {
        if (this.isDragging) return;
        
        const timelineRect = this.timeline.getBoundingClientRect();
        const x = e.clientX - timelineRect.left;
        
        // Account for timeline padding and marker width when calculating time
        const trackPadding = 10;
        const markerWidth = 20;
        const usableWidth = timelineRect.width - (2 * trackPadding) - markerWidth;
        const adjustedX = Math.max(0, Math.min(usableWidth, x - trackPadding));
        const percentage = adjustedX / usableWidth;
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
        
        // Ensure timeline elements exist
        if (!this.timeline || !this.startMarker || !this.endMarker || !this.timelineSelection) {
            console.warn('Timeline elements not found');
            return;
        }
        
        // Defer layout work until the element has a measurable width to avoid forced layout before CSS loads
        const timelineWidth = this.timeline.clientWidth;
        if (!timelineWidth || timelineWidth === 0) {
            requestAnimationFrame(() => this.updateTimelineMarkers());
            return;
        }
        
        const startPercentage = Math.max(0, Math.min(100, (this.startTime / this.timelineDuration) * 100));
        const endPercentage = Math.max(0, Math.min(100, (this.endTime / this.timelineDuration) * 100));
        
        console.log(`Timeline update: start=${this.startTime}s (${startPercentage.toFixed(1)}%), end=${this.endTime}s (${endPercentage.toFixed(1)}%), duration=${this.timelineDuration}s`);
        
        // Get timeline dimensions with proper calculations
        const markerWidth = 20; // matches CSS
        const trackPadding = 10; // CSS padding on timeline track
        
        // Calculate usable width (total width minus padding and one marker width)
        const usableWidth = timelineWidth - (2 * trackPadding) - markerWidth;
        
        // Calculate positions relative to the track
        const startPos = trackPadding + (startPercentage / 100) * usableWidth;
        const endPos = trackPadding + (endPercentage / 100) * usableWidth;
        
        // Apply positions
        this.startMarker.style.left = `${startPos}px`;
        this.endMarker.style.left = `${endPos}px`;
        
        // Update selection area (positioned between marker centers)
        const selectionStart = startPos + (markerWidth / 2);
        const selectionEnd = endPos + (markerWidth / 2);
        const selectionWidth = Math.max(0, selectionEnd - selectionStart);
        
        this.timelineSelection.style.left = `${selectionStart}px`;
        this.timelineSelection.style.width = `${selectionWidth}px`;
        
        console.log(`Markers positioned: start=${startPos}px, end=${endPos}px, selection=${selectionStart}px-${selectionEnd}px (width=${selectionWidth}px)`);
    }

    // Update time display
    updateTimeDisplay() {
        this.startTimeInput.value = this.formatDuration(this.startTime);
        this.endTimeInput.value = this.formatDuration(this.endTime);
        this.cutDuration.textContent = this.formatDuration(this.endTime - this.startTime);
        
        // Save state when timeline is modified
        if (this.sessionReady) {
            this.saveSessionState();
        }
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

    // Cut video with enhanced feedback
    async cutVideo() {
        console.log('Cut video called');
        
        if (!this.currentMetadata) {
            console.error('No metadata available');
            this.showEnhancedError('No video metadata available. Please upload a video first.', 'metadata-missing');
            return;
        }
        
        console.log('Cut parameters:', {
            filename: this.currentMetadata.filename,
            startTime: this.startTime,
            endTime: this.endTime,
            duration: this.timelineDuration
        });
        
        // Show processing section with enhanced feedback
        this.showSection('processing-section', 'Processing video cut...');
        this.enhanceProcessingUI();
        
        // Start progress monitoring
        this.startProgressMonitoring();
        
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
                
                // Stop progress monitoring and show success feedback
                this.stopProgressMonitoring();
                this.showProcessingSuccess();
                
                setTimeout(() => {
                    this.showSection('download-section', 'Video ready for download!');
                    
                    // Update session phase
                    this.updateSessionPhase('download');
                    
                    // Start timer for download phase
                    this.startSessionTimer('download');
                }, 1500);
            } else {
                throw new Error(result.message || 'Cut operation failed');
            }
            
        } catch (error) {
            console.error('Cut error:', error);
            this.stopProgressMonitoring();
            this.showEnhancedError(`Cut operation failed: ${error.message}`, 'processing-error');
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
    showSection(sectionId, message = null) {
        // Fade out current sections
        Object.values(this.sections).forEach(section => {
            section.classList.remove('active');
            section.classList.add('section');
        });
        
        // Small delay for smooth transition
        setTimeout(() => {
            Object.values(this.sections).forEach(section => {
                section.style.display = 'none';
            });
            
            const targetSection = document.getElementById(sectionId);
            if (targetSection) {
                targetSection.style.display = 'block';
                targetSection.classList.add('phase-transition');
                targetSection.classList.add('active');
                
                // Show optional transition message
                if (message) {
                    this.showTransitionMessage(message);
                }
                
                // Remove transition class after animation
                setTimeout(() => {
                    targetSection.classList.remove('phase-transition');
                }, 600);
            }
        }, 100);
    }
    
    showTransitionMessage(message) {
        // Create temporary status indicator
        const indicator = document.createElement('div');
        indicator.className = 'status-indicator loading';
        indicator.innerHTML = `
            <div class="status-dot"></div>
            ${message}
        `;
        indicator.style.position = 'fixed';
        indicator.style.top = '20px';
        indicator.style.right = '20px';
        indicator.style.zIndex = '1000';
        indicator.style.opacity = '0';
        indicator.style.transform = 'translateY(-20px)';
        indicator.style.transition = 'all 0.3s ease';
        
        document.body.appendChild(indicator);
        
        // Animate in
        setTimeout(() => {
            indicator.style.opacity = '1';
            indicator.style.transform = 'translateY(0)';
        }, 100);
        
        // Remove after delay
        setTimeout(() => {
            indicator.style.opacity = '0';
            indicator.style.transform = 'translateY(-20px)';
            setTimeout(() => {
                if (document.body.contains(indicator)) {
                    document.body.removeChild(indicator);
                }
            }, 300);
        }, 2500);
    }
    
    enhanceProcessingUI() {
        const processingSection = document.getElementById('processing-section');
        if (!processingSection) return;
        
        const duration = this.endTime - this.startTime;
        processingSection.innerHTML = `
            <div class="card">
                <h2>Processing Video</h2>
                <div class="processing-animation">
                    <div class="spinner"></div>
                    <div class="status-indicator loading">
                        <div class="status-dot"></div>
                        Cutting video segment...
                    </div>
                    <div class="processing-details" style="margin-top: 20px; padding: 15px; background: #f7fafc; border-radius: 8px; text-align: left;">
                        <p><strong>Segment Duration:</strong> ${this.formatDuration(duration)}</p>
                        <p><strong>From:</strong> ${this.formatDuration(this.startTime)} <strong>To:</strong> ${this.formatDuration(this.endTime)}</p>
                        <p><strong>Source:</strong> ${this.currentMetadata.filename}</p>
                        <p class="processing-note" style="margin-top: 15px; font-style: italic; color: #718096;">This may take a moment depending on video size and complexity.</p>
                    </div>
                </div>
            </div>
        `;
    }
    
    showProcessingSuccess() {
        const processingSection = document.getElementById('processing-section');
        if (!processingSection) return;
        
        processingSection.innerHTML = `
            <div class="card">
                <h2>Processing Complete</h2>
                <div class="processing-animation">
                    <div class="success-icon">✅</div>
                    <div class="status-indicator success" style="margin: 20px 0;">
                        <div class="status-dot"></div>
                        Video cut successfully!
                    </div>
                    <p style="color: #4a5568; margin: 15px 0;">Your video segment has been prepared and is ready for download.</p>
                    <div class="status-indicator loading" style="margin-top: 15px;">
                        <div class="status-dot"></div>
                        Preparing download...
                    </div>
                </div>
            </div>
        `;
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.showSection('error-section');
    }
    
    showEnhancedError(message, errorType = 'general') {
        // Create enhanced error display
        const errorSection = this.sections.error;
        
        let errorIcon = '⚠️';
        let errorTitle = 'Error';
        let suggestion = 'Please try again or refresh the page.';
        
        // Customize error based on type
        switch(errorType) {
            case 'processing-error':
                errorIcon = '🔧';
                errorTitle = 'Processing Error';
                suggestion = 'The video processing failed. This might be due to unsupported format or server issues. Please try with a different video file.';
                break;
            case 'metadata-missing':
                errorIcon = '📁';
                errorTitle = 'Upload Required';
                suggestion = 'Please upload a video file first before trying to cut it.';
                break;
            case 'network-error':
                errorIcon = '🌐';
                errorTitle = 'Connection Error';
                suggestion = 'Check your internet connection and try again.';
                break;
        }
        
        errorSection.innerHTML = `
            <div class="card error-card">
                <div class="error-content">
                    <div class="error-icon">${errorIcon}</div>
                    <h2>${errorTitle}</h2>
                    <div class="status-indicator error">
                        <div class="status-dot"></div>
                        ${message}
                    </div>
                    <p class="error-suggestion">${suggestion}</p>
                    <div class="error-actions">
                        <button class="btn btn-secondary" onclick="location.reload()">Refresh Page</button>
                        <button class="btn btn-primary" id="retry-enhanced">Try Again</button>
                    </div>
                </div>
            </div>
        `;
        
        this.showSection('error-section');
        
        // Bind retry button
        const retryBtn = document.getElementById('retry-enhanced');
        if (retryBtn) {
            retryBtn.addEventListener('click', async () => await this.resetApp());
        }
    }
    
    deferredInitialization() {
        // Wait for CSS to load before showing content to avoid FOUC
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                requestAnimationFrame(() => this.initializeAfterLoad());
            });
        } else {
            requestAnimationFrame(() => this.initializeAfterLoad());
        }
    }
    
    initializeAfterLoad() {
        this.showInitializing();
        this.initializeSession();
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
    
    // Session State Persistence Methods
    saveSessionState() {
        const state = {
            phase: this.sessionState.phase,
            filename: this.currentMetadata ? this.currentMetadata.filename : null,
            metadata: this.currentMetadata,
            startTime: this.startTime,
            endTime: this.endTime,
            timelineDuration: this.timelineDuration,
            outputFilename: this.outputFilename,
            sessionID: this.sessionID,
            uploadResponse: this.uploadResponse,
            timestamp: Date.now()
        };
        
        try {
            localStorage.setItem('videocutter_session_state', JSON.stringify(state));
            console.log('Session state saved:', state.phase);
        } catch (error) {
            console.warn('Failed to save session state:', error);
        }
    }
    
    restoreSessionState() {
        try {
            const savedState = localStorage.getItem('videocutter_session_state');
            if (savedState) {
                const state = JSON.parse(savedState);
                
                // Check if state is recent (within 30 minutes)
                const thirtyMinutes = 30 * 60 * 1000;
                if (Date.now() - state.timestamp > thirtyMinutes) {
                    console.log('Saved session state is too old, clearing it');
                    localStorage.removeItem('videocutter_session_state');
                    return;
                }
                
                // Restore state
                this.sessionState.phase = state.phase || 'upload';
                this.currentMetadata = state.metadata;
                this.startTime = state.startTime || 0;
                this.endTime = state.endTime || 0;
                this.timelineDuration = state.timelineDuration || 0;
                this.outputFilename = state.outputFilename;
                this.sessionID = state.sessionID;
                this.uploadResponse = state.uploadResponse;
                
                console.log('Session state restored:', this.sessionState.phase);
            }
        } catch (error) {
            console.warn('Failed to restore session state:', error);
            localStorage.removeItem('videocutter_session_state');
        }
    }
    
    async restoreSessionWorkflow() {
        console.log('Restoring session workflow for phase:', this.sessionState.phase);
        
        switch (this.sessionState.phase) {
            case 'player':
                this.showSection('player-section', 'Restoring your session...');
                
                // Restore video player
                if (this.currentMetadata && this.currentMetadata.filename) {
                    this.loadVideoPlayerImmediate();
                    this.displayVideoMetadata();
                    
                    // Restore timeline if we have duration
                    if (this.timelineDuration > 0) {
                        this.updateTimelineMarkers();
                        this.updateTimeDisplay();
                        this.cutButton.disabled = false;
                    }
                    
                    this.startSessionTimer('cut');
                    this.showTransitionMessage('Session restored - continue editing');
                }
                break;
                
            case 'download':
                if (this.outputFilename) {
                    this.showSection('download-section', 'Your video is ready!');
                    this.startSessionTimer('download');
                    this.showTransitionMessage('Previous cut restored - ready for download');
                } else {
                    // Fallback to upload if no output file
                    this.sessionState.phase = 'upload';
                    this.restoreUploadSection();
                }
                break;
                
            default:
                this.restoreUploadSection();
                break;
        }
    }
    
    updateSessionPhase(phase) {
        this.sessionState.phase = phase;
        this.saveSessionState();
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.videoCutterApp = new VideoCutterApp();
});