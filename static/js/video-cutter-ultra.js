// Video Cutter — browser-side processing with FFmpeg.wasm

class Logger {
    constructor() {
        this.logLevel = 'info';
        this.levels = {
            'debug': 0,
            'info': 1,
            'warn': 2,
            'error': 3,
            'none': 4
        };
        this.initLogger();
    }

    async initLogger() {
        try {
            const response = await fetch('/api/config');
            if (response.ok) {
                const config = await response.json();
                this.logLevel = config.logLevel || 'info';
            }
        } catch (error) {
            this.logLevel = 'info';
        }
    }

    shouldLog(level) {
        const currentLevelValue = this.levels[this.logLevel] || this.levels['info'];
        const messageLevelValue = this.levels[level] || this.levels['info'];
        return messageLevelValue >= currentLevelValue;
    }

    log(...args) {
        if (this.shouldLog('info')) console.log(...args);
    }

    debug(...args) {
        if (this.shouldLog('debug')) console.debug(...args);
    }

    warn(...args) {
        if (this.shouldLog('warn')) console.warn(...args);
    }

    error(...args) {
        if (this.shouldLog('error')) {
            console.error(...args);
        }
    }
}

const logger = new Logger();

export class VideoCutterUltra {
    constructor() {
        this.db = null;
        this.selectedVideoId = null;
        this.selectedVideoMeta = null;
        this.currentTab = 'upload';
        this.ffmpeg = null;
        this.ffmpegLoaded = false;
        this.ffmpegBusy = false;
        this.persistentStorage = false;
        this.videoCache = new Map();
        this.initializeApp();
    }
    
    async initializeApp() {
        try {
            await this.checkPersistentStorage();
            await this.initDB();
            this.bindEvents();
            requestAnimationFrame(() => {
                this.updateStorageInfo();
                this.refreshLibrary();
                this.refreshProcessed();
            });
            this.initFFmpegAsync();
        } catch (error) {
            logger.error('Failed to initialize:', error);
            this.showError('Failed to initialize app: ' + error.message);
        }
    }
    
    async checkPersistentStorage() {
        if ('storage' in navigator && 'persist' in navigator.storage) {
            const isPersisted = await navigator.storage.persisted();
            this.persistentStorage = isPersisted;
            this.updateStorageModeDisplay();
        }
    }
    
    updateStorageModeDisplay() {
        const modeText = document.getElementById('storage-mode-text');
        const toggle = document.getElementById('persistent-toggle');
        
        if (this.persistentStorage) {
            modeText.textContent = 'Persistent';
            toggle.checked = true;
        } else {
            modeText.textContent = 'Temporary';
            toggle.checked = false;
        }
    }
    
    showStorageMessage(message, type) {
        const el = document.getElementById('storage-message');
        if (!el) return;
        el.textContent = message;
        el.style.background = type === 'success' ? '#f0fff4' : type === 'error' ? '#fff5f5' : '#ebf8ff';
        el.style.color = type === 'success' ? '#276749' : type === 'error' ? '#c53030' : '#2b6cb0';
        el.style.border = `1px solid ${type === 'success' ? '#9ae6b4' : type === 'error' ? '#feb2b2' : '#90cdf4'}`;
        el.classList.remove('hidden');
        clearTimeout(this._storageMessageTimer);
        this._storageMessageTimer = setTimeout(() => el.classList.add('hidden'), 6000);
    }

    async togglePersistentStorage() {
        const toggle = document.getElementById('persistent-toggle');

        if (!('storage' in navigator && 'persist' in navigator.storage)) {
            this.showStorageMessage('Persistent storage is not supported in your browser.', 'error');
            toggle.checked = false;
            return;
        }

        if (toggle.checked) {
            try {
                const granted = await navigator.storage.persist();
                if (granted) {
                    this.persistentStorage = true;
                    this.showStorageMessage('Persistent storage enabled - your videos will not be auto-cleared by the browser.', 'success');
                    setTimeout(() => this.updateStorageInfo(), 500);
                } else {
                    this.persistentStorage = false;
                    toggle.checked = false;
                    // Chromium-based browsers deny silently based on engagement heuristics.
                    // The quota shown is already at the disk-based maximum regardless.
                    const isBrave = navigator.brave && await navigator.brave.isBrave().catch(() => false);
                    if (isBrave) {
                        this.showStorageMessage('Brave denied persistent storage. Brave caps storage at ~2 GB regardless of persistence.', 'error');
                    } else {
                        this.showStorageMessage('Browser denied persistent storage. This browser grants it silently based on site engagement — try again after using the app more.', 'info');
                    }
                }
            } catch (error) {
                logger.error('Error requesting persistent storage:', error);
                toggle.checked = false;
                this.showStorageMessage('Failed to enable persistent storage: ' + error.message, 'error');
            }
        } else {
            this.showStorageMessage('To disable persistent storage, clear your browser data for this site.', 'info');
        }

        this.updateStorageModeDisplay();
    }
    
    async initFFmpegAsync() {
        if (window.requestIdleCallback) {
            window.requestIdleCallback(() => this.initFFmpeg(), { timeout: 2000 });
        } else {
            setTimeout(() => this.initFFmpeg(), 100);
        }
    }
    
    async initFFmpeg() {
        try {
            if (typeof window.FFmpeg === 'undefined' || !window.FFmpeg.createFFmpeg) {
                logger.warn('FFmpeg not available, using simulation mode');
                return;
            }
            const { createFFmpeg } = window.FFmpeg;
            this.ffmpeg = createFFmpeg({
                log: false,
                corePath: `${window.location.origin}/js/vendor/ffmpeg-core.js`,
                mainName: 'main'
            });
            await this.ffmpeg.load();
            this.ffmpegLoaded = true;
        } catch (error) {
            logger.error('Failed to load FFmpeg.wasm:', error);
            this.ffmpegLoaded = false;
        }
    }
    
    async cleanupFFmpegFiles() {
        if (!this.ffmpeg || !this.ffmpegLoaded) return;
        try {
            const files = this.ffmpeg.FS('readdir', '/');
            for (const file of files) {
                if (file !== '.' && file !== '..' && file !== 'tmp' && file !== 'home' && file !== 'dev' && file !== 'proc') {
                    try {
                        const stats = this.ffmpeg.FS('stat', file);
                        if (stats.mode & 0o100000) this.ffmpeg.FS('unlink', file);
                    } catch (e) { /* ignore system dirs */ }
                }
            }
        } catch (e) {
            logger.debug('FFmpeg cleanup error:', e);
        }
    }
    

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('videos')) {
                    const s = db.createObjectStore('videos', { keyPath: 'id', autoIncrement: true });
                    s.createIndex('name', 'name', { unique: false });
                    s.createIndex('timestamp', 'timestamp', { unique: false });
                }
                // videoMeta: lightweight listing without loading blob data
                if (!db.objectStoreNames.contains('videoMeta')) {
                    const s = db.createObjectStore('videoMeta', { keyPath: 'id', autoIncrement: true });
                    s.createIndex('name', 'name', { unique: false });
                    s.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!db.objectStoreNames.contains('processed')) {
                    const s = db.createObjectStore('processed', { keyPath: 'id', autoIncrement: true });
                    s.createIndex('originalId', 'originalId', { unique: false });
                    s.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }
    
    bindEvents() {
        const uploadArea = document.getElementById('upload-area');
        const videoInput = document.getElementById('video-input');
        const persistentToggle = document.getElementById('persistent-toggle');
        
        uploadArea.addEventListener('click', () => videoInput.click());

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type.startsWith('video/')) {
                this.handleVideoUpload(files[0]);
            }
        });
        videoInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) this.handleVideoUpload(e.target.files[0]);
        });

        persistentToggle.addEventListener('change', () => this.togglePersistentStorage());

        const startTimeInput = document.getElementById('start-time');
        const endTimeInput = document.getElementById('end-time');
        if (startTimeInput && endTimeInput) {
            startTimeInput.addEventListener('input', () => this.updateTimeline());
            endTimeInput.addEventListener('input', () => this.updateTimeline());
        }

        const cutPreview = document.getElementById('cut-preview');
        if (cutPreview) {
            cutPreview.addEventListener('timeupdate', () => this.updateTimelineProgress());
            cutPreview.addEventListener('loadedmetadata', () => this.onVideoLoaded());
        }

        this.bindTimelineEvents();
    }
    
    bindTimelineEvents() {
        const timeline = document.getElementById('timeline');
        const handleStart = document.getElementById('handle-start');
        const handleEnd = document.getElementById('handle-end');
        
        if (!timeline) return;
        
        let isDragging = false;
        let activeHandle = null;

        // Seek on click
        timeline.addEventListener('click', (e) => {
            if (!isDragging && this.selectedVideoId) {
                const rect = timeline.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                const video = document.getElementById('cut-preview');
                if (video && video.duration) {
                    video.currentTime = percent * video.duration;
                }
            }
        });
        
        const startDrag = (handle, type) => {
            isDragging = true;
            activeHandle = type;
            document.body.style.cursor = 'ew-resize';
        };
        
        const endDrag = () => {
            isDragging = false;
            activeHandle = null;
            document.body.style.cursor = 'default';
        };
        
        const handleDrag = (e) => {
            if (!isDragging || !activeHandle) return;
            
            const rect = timeline.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const video = document.getElementById('cut-preview');
            
            if (!video || !video.duration) return;
            
            const time = percent * video.duration;
            
            if (activeHandle === 'start') {
                const endTime = this.parseTimeString(document.getElementById('end-time').value);
                if (time < endTime) {
                    document.getElementById('start-time').value = this.formatTime(time);
                    this.updateTimeline();
                }
            } else if (activeHandle === 'end') {
                const startTime = this.parseTimeString(document.getElementById('start-time').value);
                if (time > startTime) {
                    document.getElementById('end-time').value = this.formatTime(time);
                    this.updateTimeline();
                }
            }
        };
        
        if (handleStart) {
            handleStart.addEventListener('mousedown', () => startDrag(handleStart, 'start'));
        }
        if (handleEnd) {
            handleEnd.addEventListener('mousedown', () => startDrag(handleEnd, 'end'));
        }
        
        document.addEventListener('mousemove', handleDrag);
        document.addEventListener('mouseup', endDrag);
        
        if (handleStart) {
            handleStart.addEventListener('touchstart', () => startDrag(handleStart, 'start'));
        }
        if (handleEnd) {
            handleEnd.addEventListener('touchstart', () => startDrag(handleEnd, 'end'));
        }
        
        document.addEventListener('touchmove', (e) => {
            if (e.touches.length > 0) {
                handleDrag(e.touches[0]);
            }
        });
        document.addEventListener('touchend', endDrag);
    }
    
    async handleVideoUpload(file) {
        if (!file.type.startsWith('video/')) {
            this.showError('Please select a valid video file');
            return;
        }
        
        logger.log('Uploading:', file.name, this.formatBytes(file.size));
        
        const progressContainer = document.getElementById('upload-progress');
        const progressFill = document.getElementById('upload-progress-fill');
        const uploadStatus = document.getElementById('upload-status');
        
        progressContainer.classList.remove('hidden');
        uploadStatus.textContent = 'Reading file...';
        
        try {
            const estimate = await navigator.storage.estimate();
            const available = estimate.quota - estimate.usage;
            if (file.size > available * 0.9) {
                throw new Error(`Not enough storage. Need ${this.formatBytes(file.size)}, have ${this.formatBytes(available)}`);
            }

            const arrayBuffer = await this.readFileInChunks(file, (progress) => {
                const percent = Math.round(progress * 100);
                progressFill.style.width = percent + '%';
                progressFill.textContent = percent + '%';
            });
            
            uploadStatus.textContent = 'Storing in browser...';

            const metadata = {
                name: file.name,
                type: file.type,
                size: file.size,
                timestamp: new Date().toISOString()
            };
            
            const metaId = await this.storeVideoMetadata(metadata);
            const videoData = {
                id: metaId,
                data: arrayBuffer,
                ...metadata
            };
            
            await this.storeVideoData(videoData);
            
            logger.log('Stored video with ID:', metaId);
            progressContainer.classList.add('hidden');
            this.showSuccess(`Successfully uploaded ${file.name}`);
            requestAnimationFrame(() => {
                this.updateStorageInfo();
                this.refreshLibrary();
            });
            document.getElementById('video-input').value = '';
            
        } catch (error) {
            logger.error('Upload failed:', error);
            progressContainer.classList.add('hidden');
            this.showError(`Failed: ${error.message}`);
        }
    }
    
    async readFileInChunks(file, onProgress) {
        const chunkSize = 1024 * 1024 * 5;
        const chunks = [];
        let offset = 0;

        while (offset < file.size) {
            const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
            chunks.push(new Uint8Array(await chunk.arrayBuffer()));
            offset += chunkSize;
            if (onProgress) onProgress(Math.min(1.0, offset / file.size));
            await new Promise(resolve => setTimeout(resolve, 0)); // yield to keep UI responsive
        }

        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
        const result = new Uint8Array(totalLength);
        let position = 0;
        for (const chunk of chunks) {
            result.set(chunk, position);
            position += chunk.length;
        }
        return result.buffer;
    }
    
    async storeVideoMetadata(metadata) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videoMeta'], 'readwrite');
            const store = transaction.objectStore('videoMeta');
            const request = store.add(metadata);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    async storeVideoData(videoData) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videos'], 'readwrite');
            const store = transaction.objectStore('videos');
            const request = store.put(videoData);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    async getVideoMetadata(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videoMeta'], 'readonly');
            const store = transaction.objectStore('videoMeta');
            const request = store.get(id);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    async getVideoData(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videos'], 'readonly');
            const store = transaction.objectStore('videos');
            const request = store.get(id);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    async getAllVideoMetadata() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videoMeta'], 'readonly');
            const store = transaction.objectStore('videoMeta');
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    dbCount(storeName) {
        return new Promise((resolve, reject) => {
            const request = this.db.transaction([storeName], 'readonly')
                .objectStore(storeName).count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteVideo(id) {
        const transaction1 = this.db.transaction(['videos'], 'readwrite');
        const deleteRequest1 = transaction1.objectStore('videos').delete(id);
        
        const transaction2 = this.db.transaction(['videoMeta'], 'readwrite');
        const deleteRequest2 = transaction2.objectStore('videoMeta').delete(id);
        
        await new Promise((resolve, reject) => {
            deleteRequest1.onsuccess = () => {
                deleteRequest2.onsuccess = () => resolve();
                deleteRequest2.onerror = () => reject(deleteRequest2.error);
            };
            deleteRequest1.onerror = () => reject(deleteRequest1.error);
        });
        
        if (this.videoCache.has(id)) {
            const url = this.videoCache.get(id);
            URL.revokeObjectURL(url);
            this.videoCache.delete(id);
        }
    }
    
    async refreshLibrary() {
        const metadata = await this.getAllVideoMetadata();
        const library = document.getElementById('video-library');
        
        if (!library) return;
        
        if (metadata.length === 0) {
            library.innerHTML = '<p class="empty-state-msg">No videos uploaded yet</p>';
            return;
        }
        
        library.innerHTML = '';
        const fragment = document.createDocumentFragment();
        
        metadata.forEach(video => {
            const card = document.createElement('div');
            card.className = 'video-card';
            if (this.selectedVideoId === video.id) {
                card.classList.add('selected');
            }
            
            const name = this.escapeHtml(video.name);
            card.innerHTML = `
                <div class="video-name" title="${name}">${name}</div>
                <div class="video-meta">
                    Size: ${this.formatBytes(video.size)}<br>
                    Uploaded: ${new Date(video.timestamp).toLocaleString()}
                </div>
                <div class="video-actions">
                    <button class="btn btn-primary" onclick="cutter.selectVideo(${video.id})">Select</button>
                    <button class="btn btn-secondary" onclick="cutter.previewVideo(${video.id})">Preview</button>
                    <button class="btn btn-danger" onclick="cutter.deleteVideoConfirm(${video.id})">Delete</button>
                </div>
            `;
            fragment.appendChild(card);
        });
        
        library.appendChild(fragment);
    }
    
    async selectVideo(id) {
        const cutInterface = document.getElementById('cut-interface');
        const cutNoVideo = document.getElementById('cut-no-video');
        const selectedVideoName = document.getElementById('selected-video-name');
        
        if (cutInterface && cutNoVideo && selectedVideoName) {
            cutNoVideo.classList.add('hidden');
            cutInterface.classList.remove('hidden');
            selectedVideoName.textContent = 'Loading...';
        }
        
        this.switchTab('cut');
        
        try {
            const metadata = await this.getVideoMetadata(id);
            if (!metadata) {
                this.showError('Video not found');
                return;
            }
            this.selectedVideoId = id;
            this.selectedVideoMeta = metadata;
            if (selectedVideoName) selectedVideoName.textContent = metadata.name;
            await this.refreshLibrary();
            this.loadVideoForCutting(id);
            
        } catch (error) {
            logger.error('Error selecting video:', error);
            this.showError('Failed to select video');
        }
    }
    
    async loadVideoForCutting(id) {
        try {
            let blobUrl = this.videoCache.get(id);
            if (!blobUrl) {
                const videoData = await this.getVideoData(id);
                if (!videoData) throw new Error('Video data not found');
                const blob = new Blob([videoData.data], { type: videoData.type });
                blobUrl = URL.createObjectURL(blob);
                this.videoCache.set(id, blobUrl);
            }
            const cutPreview = document.getElementById('cut-preview');
            if (cutPreview) {
                const startTimeEl = document.getElementById('start-time');
                if (startTimeEl) startTimeEl.value = this.formatTime(0);
                cutPreview.src = blobUrl;
            }
        } catch (error) {
            logger.error('Error loading video for cutting:', error);
            this.showError('Failed to load video for cutting');
        }
    }
    
    async previewVideo(id) {
        try {
            let blobUrl = this.videoCache.get(id);
            if (!blobUrl) {
                const videoData = await this.getVideoData(id);
                if (!videoData) return;
                const blob = new Blob([videoData.data], { type: videoData.type });
                blobUrl = URL.createObjectURL(blob);
                this.videoCache.set(id, blobUrl);
            }
            window.open(blobUrl, '_blank');
        } catch (error) {
            logger.error('Error previewing video:', error);
        }
    }
    
    async deleteVideoConfirm(id) {
        if (!confirm('Delete this video?')) return;
        
        await this.deleteVideo(id);
        await this.updateStorageInfo();
        await this.refreshLibrary();
        
        if (this.selectedVideoId === id) {
            this.selectedVideoId = null;
            this.selectedVideoMeta = null;
            document.getElementById('cut-no-video').classList.remove('hidden');
            document.getElementById('cut-interface').classList.add('hidden');
        }
    }
    
    async clearAllVideos() {
        if (!confirm('Delete ALL videos? This cannot be undone!')) return;

        await new Promise((resolve, reject) => {
            const tx = this.db.transaction(['videos', 'videoMeta'], 'readwrite');
            tx.objectStore('videos').clear();
            tx.objectStore('videoMeta').clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });

        this.videoCache.forEach(url => URL.revokeObjectURL(url));
        this.videoCache.clear();
        this.selectedVideoId = null;
        this.selectedVideoMeta = null;

        await this.updateStorageInfo();
        await this.refreshLibrary();
        document.getElementById('cut-no-video').classList.remove('hidden');
        document.getElementById('cut-interface').classList.add('hidden');
    }
    
    async cutVideo() {
        if (!this.selectedVideoId) {
            this.showError('Please select a video first');
            return;
        }

        const startTime = this.parseTimeString(document.getElementById('start-time').value);
        const endTime = this.parseTimeString(document.getElementById('end-time').value);

        if (endTime <= startTime) {
            this.showError('End time must be greater than start time');
            return;
        }

        const progressContainer = document.getElementById('cut-progress');
        const progressFill = document.getElementById('cut-progress-fill');
        const cutStatus = document.getElementById('cut-status');
        const cutButton = document.getElementById('cut-button');

        if (progressContainer) progressContainer.classList.remove('hidden');
        if (cutButton) cutButton.disabled = true;
        if (progressFill) {
            progressFill.style.width = '1%';
            progressFill.textContent = '0%';
        }

        try {
            const videoData = await this.getVideoData(this.selectedVideoId);
            if (!videoData) throw new Error('Video data not found');

            let cutVideoData;

            if (this.ffmpegLoaded && this.ffmpeg) {
                if (this.ffmpegBusy) {
                    if (cutStatus) cutStatus.textContent = 'Waiting for previous operation...';
                    await new Promise(resolve => setTimeout(resolve, 500));
                    if (this.ffmpegBusy) this.ffmpegBusy = false;
                }

                this.ffmpegBusy = true;
                if (cutStatus) cutStatus.textContent = 'Preparing FFmpeg...';

                this.ffmpeg.setProgress(({ ratio }) => {
                    const percent = Math.round(ratio * 100);
                    if (progressFill) {
                        progressFill.style.width = Math.max(1, percent) + '%';
                        progressFill.textContent = percent + '%';
                    }
                });

                try {
                    await this.cleanupFFmpegFiles();

                    const ext = videoData.name.match(/\.[^.]+$/)?.[0] || '.mp4';
                    const inputName = 'input' + ext;
                    const outputName = 'output.mp4';
                    const inputData = new Uint8Array(videoData.data);

                    if (cutStatus) cutStatus.textContent = 'Loading video into FFmpeg...';
                    this.ffmpeg.FS('writeFile', inputName, inputData);
                    if (cutStatus) cutStatus.textContent = 'Cutting video...';

                    // Try stream copy first (lossless, fastest)
                    let success = false;
                    try {
                        await this.ffmpeg.run(
                            '-i', inputName,
                            '-ss', startTime.toString(),
                            '-to', endTime.toString(),
                            '-c', 'copy',
                            '-avoid_negative_ts', 'make_zero',
                            '-y', outputName
                        );
                        const outputData = this.ffmpeg.FS('readFile', outputName);
                        if (outputData && outputData.length > 0) {
                            success = true;
                            cutVideoData = outputData.buffer || outputData;
                        }
                    } catch (e) {
                        logger.debug('Stream copy failed, will re-encode:', e);
                    }

                    // Fall back to re-encode if stream copy failed
                    if (!success) {
                        if (cutStatus) cutStatus.textContent = 'Re-encoding video...';
                        try {
                            const files = this.ffmpeg.FS('readdir', '/');
                            if (files.includes(outputName)) this.ffmpeg.FS('unlink', outputName);
                        } catch (e) { /* ignore */ }
                        await new Promise(resolve => setTimeout(resolve, 100));
                        try {
                            await this.ffmpeg.run(
                                '-i', inputName,
                                '-ss', startTime.toString(),
                                '-to', endTime.toString(),
                                '-c:v', 'libx264',
                                '-preset', 'ultrafast',
                                '-c:a', 'aac',
                                '-y', outputName
                            );
                            const data = this.ffmpeg.FS('readFile', outputName);
                            cutVideoData = data.buffer || data;
                        } catch (reencodeError) {
                            throw new Error('Video processing failed. The video format may not be supported.');
                        }
                    }

                    if (cutStatus) cutStatus.textContent = 'Saving cut video...';

                } catch (ffmpegError) {
                    // exit(0) can occur when FFmpeg succeeds but throws anyway
                    if (ffmpegError.message?.includes('exit(0)')) {
                        try {
                            const data = this.ffmpeg.FS('readFile', 'output.mp4');
                            if (data && data.length > 0) {
                                cutVideoData = data.buffer || data;
                            } else {
                                throw new Error('FFmpeg produced no output.');
                            }
                        } catch (e) {
                            throw new Error('FFmpeg processing failed. The codec may not be supported for stream copying.');
                        }
                    } else {
                        throw new Error('FFmpeg processing failed: ' + ffmpegError.message);
                    }
                } finally {
                    try { await this.cleanupFFmpegFiles(); } catch (e) { /* ignore */ }
                    if (this.ffmpeg?.setProgress) this.ffmpeg.setProgress(() => {});
                    this.ffmpegBusy = false;
                }

            } else {
                // FFmpeg not loaded - simulation mode
                if (cutStatus) cutStatus.textContent = 'Processing video (simulation mode)...';
                for (let i = 0; i <= 100; i += 10) {
                    if (progressFill) {
                        progressFill.style.width = Math.max(1, i) + '%';
                        progressFill.textContent = i + '%';
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                cutVideoData = videoData.data;
            }

            const processedData = {
                originalId: this.selectedVideoId,
                originalName: videoData.name,
                name: this.generateKutName(videoData.name),
                type: 'video/mp4',
                size: cutVideoData.byteLength || cutVideoData.length || videoData.size,
                startTime: this.formatTime(startTime),
                endTime: this.formatTime(endTime),
                duration: this.formatTime(endTime - startTime),
                data: cutVideoData,
                timestamp: new Date().toISOString(),
                isActuallyCut: this.ffmpegLoaded
            };

            await this.storeProcessedVideo(processedData);

            if (progressContainer) progressContainer.classList.add('hidden');
            const modeText = this.ffmpegLoaded ? ' (with FFmpeg)' : ' (simulation)';
            this.showSuccess(`Video cut successfully${modeText}! Check the Processed tab.`);

            // Reinitialize after each cut for a clean FFmpeg state
            if (this.ffmpegLoaded && this.ffmpeg) {
                if (this.ffmpeg.isLoaded?.()) {
                    try { this.ffmpeg.exit(); } catch (e) { /* expected */ }
                }
                this.ffmpeg = null;
                this.ffmpegLoaded = false;
                setTimeout(() => this.initFFmpeg().catch(err => logger.error('FFmpeg reinit failed:', err)), 100);
            }

            await this.updateStorageInfo();
            await this.refreshProcessed();

        } catch (error) {
            logger.error('Cut failed:', error);
            if (progressContainer) progressContainer.classList.add('hidden');
            this.showError(`Failed: ${error.message}`);
            if (this.ffmpegBusy) {
                this.ffmpegBusy = false;
                await this.cleanupFFmpegFiles();
            }
        } finally {
            if (cutButton) cutButton.disabled = false;
        }
    }
    
    async storeProcessedVideo(videoData) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['processed'], 'readwrite');
            const store = transaction.objectStore('processed');
            const request = store.add(videoData);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    async getAllProcessed() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['processed'], 'readonly');
            const store = transaction.objectStore('processed');
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }
    
    async getProcessedVideo(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['processed'], 'readonly');
            const store = transaction.objectStore('processed');
            const request = store.get(id);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    onVideoLoaded() {
        const video = document.getElementById('cut-preview');
        const startTimeEl = document.getElementById('start-time');
        const endTimeEl = document.getElementById('end-time');
        
        if (video && video.duration && startTimeEl && endTimeEl) {
            startTimeEl.value = this.formatTime(0);
            endTimeEl.value = this.formatTime(video.duration);
            this.updateTimeline();
        }
    }
    
    updateTimeline() {
        const video = document.getElementById('cut-preview');
        const startTimeEl = document.getElementById('start-time');
        const endTimeEl = document.getElementById('end-time');
        
        if (!video || !video.duration || !startTimeEl || !endTimeEl) return;

        const startTime = this.parseTimeString(startTimeEl.value) || 0;
        const endTime = this.parseTimeString(endTimeEl.value) || video.duration;
        const startPercent = Math.max(0, Math.min(100, (startTime / video.duration) * 100));
        const endPercent = Math.max(0, Math.min(100, (endTime / video.duration) * 100));

        const selection = document.getElementById('timeline-selection');
        if (selection) {
            selection.style.left = startPercent + '%';
            selection.style.width = (endPercent - startPercent) + '%';
        }

        const handleStart = document.getElementById('handle-start');
        const handleEnd = document.getElementById('handle-end');
        if (handleStart) handleStart.style.left = startPercent + '%';
        if (handleEnd)   handleEnd.style.left = endPercent + '%';

        const timeStart = document.getElementById('time-start');
        const timeEnd   = document.getElementById('time-end');
        if (timeStart) timeStart.textContent = this.formatTime(startTime);
        if (timeEnd)   timeEnd.textContent   = this.formatTime(endTime);

        const durationEl = document.getElementById('duration');
        if (durationEl) durationEl.textContent = this.formatTime(endTime - startTime);
    }
    
    updateTimelineProgress() {
        const video = document.getElementById('cut-preview');
        if (!video || !video.duration) return;
        
        const progress = document.getElementById('timeline-progress');
        if (progress) {
            const percent = (video.currentTime / video.duration) * 100;
            progress.style.width = percent + '%';
        }
    }
    
    setCurrentAsStart() {
        const video = document.getElementById('cut-preview');
        const startTime = document.getElementById('start-time');
        const endTime = document.getElementById('end-time');
        if (video && startTime && endTime) {
            const endSeconds = this.parseTimeString(endTime.value) || video.duration;
            if (video.currentTime < endSeconds) {
                startTime.value = this.formatTime(video.currentTime);
                this.updateTimeline();
            } else {
                this.showInfo('Start time must be before end time');
            }
        }
    }
    
    setCurrentAsEnd() {
        const video = document.getElementById('cut-preview');
        const endTime = document.getElementById('end-time');
        const startTime = document.getElementById('start-time');
        if (video && endTime && startTime) {
            const startSeconds = this.parseTimeString(startTime.value) || 0;
            if (video.currentTime > startSeconds) {
                endTime.value = this.formatTime(video.currentTime);
                this.updateTimeline();
            } else {
                this.showInfo('End time must be after start time');
            }
        }
    }
    
    formatTime(seconds) {
        const hours   = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs    = Math.floor(seconds % 60);
        const ms      = Math.round((seconds % 1) * 10);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${ms}`;
    }

    generateKutName(originalName) {
        const words = [
            'apple','banana','cedar','delta','echo','falcon','gizmo','harbor',
            'island','jupiter','kappa','lima','mango','november','omega','pearl',
            'quartz','raven','sierra','tango','umbra','vivid','willow','xeno',
            'yonder','zephyr','fruitybaboon','playingwithmymonkey','otter','bear',
            'lion','tiger','eagle','shark','whale','dolphin','panda','koala',
            'platypus','narwhal','unicorn','dragon','phoenix','griffin',
            'pegasus','hydra','cerberus','minotaur','sphinx','chimera',
            'kompound','ngk','smile','happy','sunny','breezy','cloudy','stormy'
        ];
        const word = words[Math.floor(Math.random() * words.length)];
        const digits = String(Math.floor(10000 + Math.random() * 90000));
        const ext = (originalName && originalName.match(/\.[^.]+$/)?.[0]) || '.mp4';
        return `${word}_${digits}_kut${ext}`;
    }
    
    parseTimeString(timeStr) {
        const parts = timeStr.split(':');
        if (parts.length !== 3) return 0;
        const hours        = parseInt(parts[0]) || 0;
        const minutes      = parseInt(parts[1]) || 0;
        const secondsParts = parts[2].split('.');
        const seconds      = parseInt(secondsParts[0]) || 0;
        const ms           = parseInt(secondsParts[1]) || 0;
        // single decimal place: .9 = 0.9 s, not 0.009 s
        return hours * 3600 + minutes * 60 + seconds + ms / 10;
    }
    
    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
            if (tab.textContent.toLowerCase().includes(tabName.toLowerCase())) {
                tab.classList.add('active');
            }
        });
        
        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        
        const tabContent = document.getElementById(`${tabName}-tab`);
        if (tabContent) {
            tabContent.classList.add('active');
        }
        
        this.currentTab = tabName;
    }
    
    async updateStorageInfo() {
        try {
            if ('storage' in navigator && 'estimate' in navigator.storage) {
                const estimate = await navigator.storage.estimate();
                const quotaGB = estimate.quota / (1024 * 1024 * 1024);
                const usedMB = estimate.usage / (1024 * 1024);
                const availableGB = (estimate.quota - estimate.usage) / (1024 * 1024 * 1024);
                
                const quotaEl = document.getElementById('storage-quota');
                const usedEl = document.getElementById('storage-used');
                const availableEl = document.getElementById('storage-available');
                
                if (quotaEl) quotaEl.textContent = `${quotaGB.toFixed(1)} GB`;
                if (usedEl) {
                    if (usedMB < 1) {
                        usedEl.textContent = `${(usedMB * 1024).toFixed(1)} KB`;
                    } else if (usedMB < 1024) {
                        usedEl.textContent = `${usedMB.toFixed(1)} MB`;
                    } else {
                        usedEl.textContent = `${(usedMB / 1024).toFixed(2)} GB`;
                    }
                }
                if (availableEl) availableEl.textContent = `${availableGB.toFixed(2)} GB`;
            }
            
            const [videoCount, processedCount] = await Promise.all([
                this.dbCount('videoMeta'),
                this.dbCount('processed')
            ]);
            const countEl = document.getElementById('video-count');
            if (countEl) countEl.textContent = videoCount;
            const processedCountEl = document.getElementById('processed-count');
            if (processedCountEl) processedCountEl.textContent = processedCount;
        } catch (error) {
            logger.error('Error updating storage info:', error);
        }
    }
    
    escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
    
    async refreshProcessed() {
        const processed = await this.getAllProcessed();
        const list = document.getElementById('processed-list');
        
        if (!list) return;
        
        const countEl = document.getElementById('processed-count');
        if (countEl) countEl.textContent = processed.length;
        
        if (processed.length === 0) {
            list.innerHTML = '<p class="empty-state-msg">No processed videos yet</p>';
            return;
        }
        
        list.innerHTML = '';
        const fragment = document.createDocumentFragment();
        processed.forEach(video => {
            const item = document.createElement('li');
            item.className = 'processed-item';
            const pname = this.escapeHtml(video.name);
            const oname = this.escapeHtml(video.originalName);
            item.innerHTML = `
                    <div class="processed-info">
                        <div class="processed-name">${pname}</div>
                        <div class="processed-meta">
                            Duration: ${video.duration} (${video.startTime} - ${video.endTime})<br>
                            Size: ${this.formatBytes(video.size)} |
                            Processed: ${new Date(video.timestamp).toLocaleString()}
                            ${video.isActuallyCut ? ' | FFmpeg' : ' | Simulated'}<br>
                            Original: ${oname}
                        </div>
                <div class="video-actions">
                    <button class="btn btn-success" onclick="cutter.downloadProcessed(${video.id})">Download</button>
                    <button class="btn btn-secondary" onclick="cutter.previewProcessed(${video.id})">Preview</button>
                    <button class="btn btn-danger" onclick="cutter.deleteProcessed(${video.id})">Delete</button>
                </div>
            `;
            fragment.appendChild(item);
        });
        
        list.appendChild(fragment);
    }
    
    async downloadProcessed(id) {
        try {
            const video = await this.getProcessedVideo(id);
            if (!video) return;
            
            const blob = new Blob([video.data], { type: video.type });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = video.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            logger.error('Error downloading video:', error);
            this.showError('Failed to download video');
        }
    }
    
    async previewProcessed(id) {
        try {
            const video = await this.getProcessedVideo(id);
            if (!video) return;
            
            const blob = new Blob([video.data], { type: video.type });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (error) {
            logger.error('Error previewing video:', error);
            this.showError('Failed to preview video');
        }
    }

    async deleteProcessed(id) {
        if (!confirm('Delete this processed video?')) return;

        try {
            const transaction = this.db.transaction(['processed'], 'readwrite');
            const store = transaction.objectStore('processed');
            const deleteRequest = store.delete(id);
            
            await new Promise((resolve, reject) => {
                deleteRequest.onsuccess = () => resolve();
                deleteRequest.onerror = () => reject(deleteRequest.error);
            });
            await this.updateStorageInfo();
            await this.refreshProcessed();
        } catch (error) {
            logger.error('Error deleting processed video:', error);
            this.showError('Failed to delete video');
        }
    }
    
    async clearAllProcessed() {
        if (!confirm('Delete ALL processed videos?')) return;
        
        try {
            await new Promise((resolve, reject) => {
                const tx = this.db.transaction(['processed'], 'readwrite');
                tx.objectStore('processed').clear();
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
            await this.updateStorageInfo();
            await this.refreshProcessed();
        } catch (error) {
            logger.error('Error clearing processed videos:', error);
            this.showError('Failed to clear processed videos');
        }
    }
    
    async showStorageInfo() {
        const modal = document.getElementById('storage-modal');
        if (modal) {
            modal.classList.add('show');
            await this.updateStorageQuotaDetails();
        }
    }
    
    async detectBrowser() {
        const ua = navigator.userAgent;
        const isBrave = navigator.brave && await navigator.brave.isBrave().catch(() => false);
        if (isBrave) return 'Brave';
        if (ua.includes('Edg/')) return 'Microsoft Edge';
        if (ua.includes('Firefox/')) return 'Firefox';
        if (ua.includes('Chrome/')) return 'Chrome';
        if (ua.includes('Safari/')) return 'Safari';
        return 'Unknown';
    }

    async updateStorageQuotaDetails() {
        const quotaDetailsEl = document.getElementById('quota-details');
        if (!quotaDetailsEl) return;

        try {
            if (!('storage' in navigator && 'estimate' in navigator.storage)) {
                quotaDetailsEl.innerHTML = '<p style="color: #e53e3e;">Storage API not supported in this browser</p>';
                return;
            }

            const [estimate, isPersistent, browserName] = await Promise.all([
                navigator.storage.estimate(),
                navigator.storage.persisted(),
                this.detectBrowser()
            ]);

            const quotaGB   = (estimate.quota / (1024 * 1024 * 1024)).toFixed(2);
            const usedMB    = (estimate.usage / (1024 * 1024)).toFixed(2);
            const usedGB    = (estimate.usage / (1024 * 1024 * 1024)).toFixed(3);
            const availGB   = ((estimate.quota - estimate.usage) / (1024 * 1024 * 1024)).toFixed(2);
            const pctUsed   = ((estimate.usage / estimate.quota) * 100).toFixed(2);

            // Browser-specific note about quota behaviour
            const isChromium = ['Brave', 'Chrome', 'Microsoft Edge'].includes(browserName);
            let quotaNote = '';
            if (browserName === 'Brave') {
                quotaNote = '<strong>Brave restriction:</strong> Brave enforces a hard ~2 GB per-origin storage cap as a privacy/anti-fingerprinting measure. ' +
                    'Enabling persistent storage will prevent eviction but cannot increase this cap. ' +
                    'For large videos, use Firefox instead — it grants significantly more quota when persistence is allowed.';
            } else if (browserName === 'Microsoft Edge') {
                quotaNote = `${browserName} sets this quota based on your available disk space. ` +
                    'Persistent storage prevents eviction but does not change the quota number.';
            } else if (isChromium) {
                quotaNote = `${browserName} sets this quota based on your available disk space. ` +
                    'Persistent storage prevents eviction but does not change the quota number.';
            } else if (browserName === 'Firefox') {
                quotaNote = 'Firefox limits quota to ~10% of disk without persistence. ' +
                    'Enabling persistent storage (and accepting the browser prompt) can significantly increase the available quota.';
            } else if (browserName === 'Safari') {
                quotaNote = 'Safari starts with a 1 GB quota and may prompt to increase it when storage is needed.';
            }

            quotaDetailsEl.innerHTML = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                    <div><strong>Browser:</strong> ${browserName}</div>
                    <div><strong>Storage Mode:</strong> ${isPersistent
                        ? '<span style="color: #48bb78;">Persistent</span>'
                        : '<span style="color: #f6ad55;">Temporary</span>'}</div>
                    <div><strong>Quota:</strong> ${quotaGB} GB</div>
                    <div><strong>Used:</strong> ${usedMB < 1024 ? usedMB + ' MB' : usedGB + ' GB'} (${pctUsed}%)</div>
                    <div><strong>Available:</strong> ${availGB} GB</div>
                    <div><strong>Videos:</strong> ${await this.getVideoCount()}</div>
                </div>
                ${quotaNote ? `<p style="margin-top: 0.75rem; padding: 0.5rem; background: #f0f4ff; border-left: 3px solid #667eea; font-size: 0.85rem;">${quotaNote}</p>` : ''}
                ${!isPersistent ? '<p style="margin-top: 0.5rem; padding: 0.5rem; background: #fff5f5; border-left: 3px solid #f6ad55; font-size: 0.85rem;"><strong>Tip:</strong> Enable persistent storage above to prevent the browser from auto-clearing your videos.</p>' : ''}
            `;

            this.updateStorageInfo();
        } catch (error) {
            logger.error('Error getting storage quota details:', error);
            quotaDetailsEl.innerHTML = '<p style="color: #e53e3e;">Error loading storage information</p>';
        }
    }
    
    async getVideoCount() {
        try { return await this.dbCount('videoMeta'); } catch (e) { return 0; }
    }
    
    hideStorageInfo() {
        const modal = document.getElementById('storage-modal');
        if (modal) modal.classList.remove('show');
    }
    
    showMessage(message, type) {
        let messageContainer;
        switch (this.currentTab) {
            case 'upload':
                messageContainer = document.getElementById('upload-message');
                break;
            case 'cut':
                messageContainer = document.getElementById('cut-message');
                break;
            default:
                const tempMsg = document.createElement('div');
                tempMsg.className = `status-message status-${type}`;
                tempMsg.textContent = message;
                document.querySelector('.container').appendChild(tempMsg);
                setTimeout(() => tempMsg.remove(), 5000);
                return;
        }
        
        if (messageContainer) {
            messageContainer.className = `status-message status-${type}`;
            messageContainer.textContent = message;
            messageContainer.classList.remove('hidden');
            
            setTimeout(() => {
                messageContainer.classList.add('hidden');
            }, 5000);
        }
    }
    
    showSuccess(message) {
        this.showMessage(message, 'success');
    }
    
    showError(message) {
        this.showMessage(message, 'error');
    }
    
    showInfo(message) {
        this.showMessage(message, 'info');
    }
    
    async clearAllBrowserStorage() {
        const confirmed = confirm(
            'WARNING: This will permanently delete ALL data stored by this app:\n\n' +
            '\u2022 All uploaded videos\n' +
            '\u2022 All processed/cut videos\n' +
            '\u2022 All settings and metadata\n\n' +
            'This cannot be undone. Continue?'
        );
        if (!confirmed) return;

        try {
            // Revoke in-memory blob URLs
            this.videoCache.forEach(url => { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } });
            this.videoCache.clear();

            // Close the DB connection first, then delete the database.
            // Closing before deleteDatabase ensures no open transactions block deletion.
            if (this.db) {
                this.db.close();
                this.db = null;
            }
            await new Promise((resolve) => {
                const req = indexedDB.deleteDatabase('VideoCutterUltraDB');
                req.onsuccess = () => resolve();
                req.onerror   = () => { logger.error('IndexedDB delete error:', req.error); resolve(); };
                // onblocked fires when another tab still holds a connection.
                // Resolving here is safe — the DB will be deleted once the other tab closes.
                req.onblocked = () => { logger.warn('IndexedDB delete blocked (another tab may be open)'); resolve(); };
            });

            // Web storage
            try { localStorage.clear(); }   catch (e) { /* ignore */ }
            try { sessionStorage.clear(); } catch (e) { /* ignore */ }

            // Cache API (Service Worker caches)
            if ('caches' in window) {
                const names = await caches.keys().catch(() => []);
                await Promise.all(names.map(n => caches.delete(n)));
            }

            // FFmpeg in-memory filesystem
            if (this.ffmpeg) {
                try {
                    const files = this.ffmpeg.FS('readdir', '/');
                    const skip = ['.', '..', 'tmp', 'home', 'dev', 'proc'];
                    for (const f of files) {
                        if (!skip.includes(f)) {
                            try { this.ffmpeg.FS('unlink', f); } catch (e) { /* ignore */ }
                        }
                    }
                } catch (e) { /* ignore */ }
            }

            this.selectedVideoId   = null;
            this.selectedVideoMeta = null;
            this.persistentStorage = false;
            this.hideStorageInfo();

            alert('All storage cleared. The page will now reload.');
            window.location.reload();

        } catch (error) {
            logger.error('Storage clear failed:', error);
            this.showError('Failed to clear storage: ' + error.message);
        }
    }
}
