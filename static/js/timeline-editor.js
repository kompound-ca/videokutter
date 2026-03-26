// Timeline Editor — multi-segment video trimming

import { logger } from '/js/shared/logger.js';
import { formatTime, formatBytes, escapeHtml, generateKutName } from '/js/shared/utils.js';
import { VideoDB } from '/js/shared/db.js';
import { FFmpegManager } from '/js/shared/ffmpeg-manager.js';

export class TimelineEditor {
    constructor() {
        this.videoDB = new VideoDB();
        this.ffmpegMgr = new FFmpegManager();
        this.selectedVideoId = null;
        this.videoDuration = 0;
        this.segments = [];        // [{ start, end, keep }]
        this.videoCache = new Map();

        this._activeSplitIndex = null; // index of split being dragged
        this._dragging = false;

        this.initializeApp();
    }

    // ─── Init ────────────────────────────────────────────────────────────────

    async initializeApp() {
        try {
            await this.videoDB.init();
            this.bindEvents();
            await this.refreshVideoList();
            await this.refreshOutput();
            this.checkStoragePermission();
            this.ffmpegMgr.initAsync();
        } catch (error) {
            logger.error('Failed to initialize timeline editor:', error);
            this.showMessage('Failed to initialize: ' + error.message, 'error', 'te-select-message');
        }
    }

    switchTab(name) {
        document.getElementById('te-panel-library').classList.toggle('hidden', name !== 'library');
        document.getElementById('te-panel-processed').classList.toggle('hidden', name !== 'processed');
        document.getElementById('te-tab-btn-library').classList.toggle('active', name === 'library');
        document.getElementById('te-tab-btn-processed').classList.toggle('active', name === 'processed');
        if (name === 'processed') this.clearPlayer();
    }

    bindEvents() {
        const preview = document.getElementById('te-preview');
        if (preview) {
            preview.addEventListener('loadedmetadata', () => this.onVideoLoaded());
            preview.addEventListener('timeupdate', () => this.updatePlayhead());
        }

        // Upload area
        const uploadArea  = document.getElementById('te-upload-area');
        const videoInput  = document.getElementById('te-video-input');
        if (uploadArea && videoInput) {
            uploadArea.addEventListener('click', () => videoInput.click());
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.classList.add('dragover');
            });
            uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('dragover');
                const file = e.dataTransfer.files[0];
                if (file?.type.startsWith('video/')) this.handleVideoUpload(file);
            });
            videoInput.addEventListener('change', (e) => {
                if (e.target.files[0]) this.handleVideoUpload(e.target.files[0]);
            });
        }

        // Help popover — toggle on button click, close on outside click
        const helpBtn = document.getElementById('te-help-btn');
        const helpPopover = document.getElementById('te-help-popover');
        if (helpBtn && helpPopover) {
            helpBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                helpPopover.classList.toggle('visible');
            });
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.te-help-wrapper')) helpPopover.classList.remove('visible');
            });
        }

        // Arrow key seeking — left/right seek one frame (1/30 s)
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const tag = document.activeElement?.tagName.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
            const vid = document.getElementById('te-preview');
            if (!vid || !vid.duration) return;
            e.preventDefault();
            const step = 1 / 30;
            vid.currentTime = Math.max(0, Math.min(vid.duration, vid.currentTime + (e.key === 'ArrowLeft' ? -step : step)));
        });
    }

    // ─── Video List ──────────────────────────────────────────────────────────

    async refreshVideoList() {
        try {
            const allMeta = await this.videoDB.getAllVideoMetadata();
            const library = document.getElementById('te-video-library');
            if (!library) return;

            if (allMeta.length === 0) {
                library.innerHTML = '<p class="te-library-empty">No videos in library — upload one above.</p>';
                return;
            }

            allMeta.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            const fragment = document.createDocumentFragment();
            allMeta.forEach(meta => {
                const card = document.createElement('div');
                card.className = 'te-video-card' + (meta.id === this.selectedVideoId ? ' active' : '');
                card.dataset.id = meta.id;
                card.innerHTML = `
                    <div class="te-video-card-info">
                        <div class="te-video-card-name">${escapeHtml(meta.name)}</div>
                        <div class="te-video-card-meta">${formatBytes(meta.size)} &nbsp;·&nbsp; ${new Date(meta.timestamp).toLocaleDateString()}</div>
                    </div>
                    <div class="te-video-card-actions">
                        <button class="btn btn-primary" onclick="editor.loadVideo(${meta.id})">Edit</button>
                        <button class="btn btn-danger"  onclick="editor.deleteVideo(${meta.id})">Delete</button>
                    </div>
                `;
                fragment.appendChild(card);
            });
            library.innerHTML = '';
            library.appendChild(fragment);
        } catch (error) {
            logger.error('Error refreshing video list:', error);
        }
    }

    // ─── Video Loading ────────────────────────────────────────────────────────

    async loadVideo(id) {
        // Clicking Edit on the already-active video collapses the player
        if (this.selectedVideoId === id) {
            this.clearPlayer();
            document.querySelectorAll('.te-video-card').forEach(c => c.classList.remove('active'));
            return;
        }
        try {
            const meta = await this.videoDB.getVideoMetadata(id);
            if (!meta) { this.showMessage('Video not found.', 'error', 'te-select-message'); return; }

            document.getElementById('te-video-name').textContent = meta.name;

            let blobUrl = this.videoCache.get(id);
            if (!blobUrl) {
                const data = await this.videoDB.getVideoData(id);
                if (!data) throw new Error('Video data not found');
                const blob = new Blob([data.data], { type: data.type });
                blobUrl = URL.createObjectURL(blob);
                this.videoCache.set(id, blobUrl);
            }

            const preview = document.getElementById('te-preview');
            if (preview) preview.src = blobUrl;

            this.selectedVideoId = id;
            document.querySelectorAll('.te-video-card').forEach(c => c.classList.toggle('active', parseInt(c.dataset.id) === id));
            document.getElementById('te-player-section').classList.remove('hidden');
            document.getElementById('te-select-message').classList.add('hidden');
        } catch (error) {
            logger.error('Error loading video:', error);
            this.showMessage('Failed to load video: ' + error.message, 'error', 'te-select-message');
        }
    }

    clearPlayer() {
        this.selectedVideoId = null;
        this.videoDuration = 0;
        this.segments = [];
        const preview = document.getElementById('te-preview');
        if (preview) preview.src = '';
        document.getElementById('te-player-section').classList.add('hidden');
    }

    // ─── Upload ───────────────────────────────────────────────────────────────

    async handleVideoUpload(file) {
        const progressContainer = document.getElementById('te-upload-progress');
        const progressFill      = document.getElementById('te-upload-progress-fill');
        const progressStatus    = document.getElementById('te-upload-status');
        const uploadArea        = document.getElementById('te-upload-area');

        if (progressContainer) progressContainer.classList.remove('hidden');
        if (progressStatus)    progressStatus.textContent = 'Reading file...';
        if (uploadArea)        uploadArea.style.pointerEvents = 'none';

        try {
            const estimate  = await navigator.storage.estimate();
            const available = estimate.quota - estimate.usage;
            if (file.size > available * 0.9) {
                throw new Error(`Not enough storage. Need ${formatBytes(file.size)}, have ${formatBytes(available)}`);
            }

            const arrayBuffer = await this.readFileInChunks(file, (progress) => {
                const pct = Math.round(progress * 100);
                if (progressFill) { progressFill.style.width = pct + '%'; progressFill.textContent = pct + '%'; }
            });

            if (progressStatus) progressStatus.textContent = 'Storing in browser...';

            const metadata = { name: file.name, type: file.type, size: file.size, timestamp: new Date().toISOString() };
            const metaId   = await this.videoDB.storeVideoMetadata(metadata);
            await this.videoDB.storeVideoData({ id: metaId, data: arrayBuffer, ...metadata });

            document.getElementById('te-video-input').value = '';
            await this.refreshVideoList();
            await this.loadVideo(metaId);

            this.showMessage(`Uploaded: ${escapeHtml(file.name)}`, 'success', 'te-select-message');
        } catch (error) {
            logger.error('Upload failed:', error);
            this.showMessage('Upload failed: ' + error.message, 'error', 'te-select-message');
        } finally {
            if (progressContainer) progressContainer.classList.add('hidden');
            if (uploadArea)        uploadArea.style.pointerEvents = '';
        }
    }

    async readFileInChunks(file, onProgress) {
        const chunkSize = 5 * 1024 * 1024;
        const chunks = [];
        let offset = 0;
        while (offset < file.size) {
            const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
            chunks.push(new Uint8Array(await chunk.arrayBuffer()));
            offset += chunkSize;
            if (onProgress) onProgress(Math.min(1.0, offset / file.size));
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
        const result = new Uint8Array(totalLength);
        let pos = 0;
        for (const chunk of chunks) { result.set(chunk, pos); pos += chunk.length; }
        return result.buffer;
    }

    deleteSelectedVideo() {
        if (this.selectedVideoId) this.deleteVideo(this.selectedVideoId);
    }

    async deleteVideo(id) {
        const meta = await this.videoDB.getVideoMetadata(id);
        if (!confirm(`Delete "${meta?.name ?? 'this video'}"? This cannot be undone.`)) return;
        try {
            if (this.selectedVideoId === id) this.clearPlayer();
            if (this.videoCache.has(id)) {
                URL.revokeObjectURL(this.videoCache.get(id));
                this.videoCache.delete(id);
            }
            await this.videoDB.deleteVideo(id);
            await this.refreshVideoList();
            this.showMessage('Video deleted from library.', 'success', 'te-select-message');
        } catch (e) {
            logger.error('Delete failed:', e);
            this.showMessage('Failed to delete video.', 'error', 'te-select-message');
        }
    }

    async checkStoragePermission() {
        if (!navigator.storage?.persisted) return;
        const notice = document.getElementById('te-storage-notice');
        if (!notice) return;
        const isPersisted = await navigator.storage.persisted();
        if (isPersisted) {
            notice.classList.add('hidden');
        } else {
            notice.classList.remove('hidden');
            notice.className = 'te-storage-notice';
            notice.innerHTML = `<button class="btn-storage" onclick="editor.requestPersistentStorage()">Enable Persistent Storage</button>`;
        }
    }

    async requestPersistentStorage() {
        try {
            const granted = await navigator.storage.persist();
            await this.checkStoragePermission();
            if (granted) {
                this.showMessage('Persistent storage enabled — your videos are now protected.', 'success', 'te-select-message');
            } else {
                // Chrome grants this automatically based on site engagement/bookmarks — not via a prompt
                this.showMessage('Not granted automatically. Try bookmarking this site — browsers like Chrome use bookmarks and visit frequency to decide.', 'info', 'te-select-message');
            }
        } catch (e) {
            logger.error('requestPersist failed:', e);
        }
    }

    onVideoLoaded() {
        const preview = document.getElementById('te-preview');
        if (!preview || !preview.duration) return;
        this.videoDuration = preview.duration;

        // Start with a single KEEP segment spanning the whole video
        this.segments = [{ start: 0, end: this.videoDuration, keep: true }];

        document.getElementById('te-time-start-label').textContent = formatTime(0);
        document.getElementById('te-time-end-label').textContent = formatTime(this.videoDuration);

        this.renderTimeline();
        this.renderSegmentTable();
        this.updateKeepSummary();
        this.bindTimelineEvents();
    }

    // ─── Segment Model ────────────────────────────────────────────────────────

    /** Split the segment that contains `time` at that exact time. */
    addSplitAt(time) {
        if (!this.videoDuration || time <= 0 || time >= this.videoDuration) return;

        const idx = this.segments.findIndex(s => time > s.start && time < s.end);
        if (idx === -1) return; // exactly on an existing boundary

        const seg = this.segments[idx];
        const left  = { start: seg.start, end: time,    keep: seg.keep };
        const right = { start: time,       end: seg.end, keep: seg.keep };
        this.segments.splice(idx, 1, left, right);
    }

    /** Remove the split between segments[idx] and segments[idx+1]. */
    removeSplitBetween(idx) {
        if (idx < 0 || idx >= this.segments.length - 1) return;
        const left  = this.segments[idx];
        const right = this.segments[idx + 1];
        const merged = { start: left.start, end: right.end, keep: left.keep };
        this.segments.splice(idx, 2, merged);
    }

    /** Move the split between segments[idx] and segments[idx+1] to newTime. */
    moveSplit(idx, newTime) {
        if (idx < 0 || idx >= this.segments.length - 1) return;
        const min = this.segments[idx].start + 0.05;
        const max = this.segments[idx + 1].end - 0.05;
        const t = Math.max(min, Math.min(max, newTime));
        this.segments[idx].end = t;
        this.segments[idx + 1].start = t;
    }

    toggleSegment(idx) {
        if (idx < 0 || idx >= this.segments.length) return;
        this.segments[idx].keep = !this.segments[idx].keep;
    }

    resetSegments() {
        if (!this.videoDuration) return;
        this.segments = [{ start: 0, end: this.videoDuration, keep: true }];
        this.renderTimeline();
        this.renderSegmentTable();
        this.updateKeepSummary();
    }

    // ─── Timeline Rendering ───────────────────────────────────────────────────

    renderTimeline() {
        const timeline = document.getElementById('te-timeline');
        if (!timeline || !this.videoDuration) return;

        // Remove all segment/split children (keep playhead)
        Array.from(timeline.children).forEach(el => {
            if (!el.classList.contains('te-playhead')) el.remove();
        });

        // Render segments
        this.segments.forEach((seg, i) => {
            const leftPct  = (seg.start / this.videoDuration) * 100;
            const widthPct = ((seg.end - seg.start) / this.videoDuration) * 100;

            const el = document.createElement('div');
            el.className = `te-segment ${seg.keep ? 'keep' : 'remove'}`;
            el.style.left  = leftPct + '%';
            el.style.width = widthPct + '%';

            const durSecs = seg.end - seg.start;
            if (widthPct > 5) {
                el.textContent = seg.keep ? `KEEP ${formatTime(durSecs)}` : `SKIP ${formatTime(durSecs)}`;
            }

            // Double-click segment to toggle Keep / Skip
            el.addEventListener('dblclick', (e) => {
                e.stopPropagation(); // prevent timeline click from seeking
                this.toggleSegment(i);
                this.renderTimeline();
                this.renderSegmentTable();
                this.updateKeepSummary();
            });

            timeline.appendChild(el);
        });

        // Render split point handles (between consecutive segments)
        for (let i = 0; i < this.segments.length - 1; i++) {
            const splitTime = this.segments[i].end;
            const leftPct   = (splitTime / this.videoDuration) * 100;

            const el = document.createElement('div');
            el.className = 'te-split';
            el.style.left = leftPct + '%';
            el.dataset.splitIndex = i;
            el.title = 'Drag to move · Double-click to remove';

            // Time label inside the handle
            const label = document.createElement('span');
            label.className = 'te-split-label';
            label.textContent = formatTime(splitTime);
            el.appendChild(label);

            // Double-click to remove split
            el.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this.removeSplitBetween(i);
                this.renderTimeline();
                this.renderSegmentTable();
                this.updateKeepSummary();
            });

            timeline.appendChild(el);
        }

        // Update remove-last-split button state
        const removeBtn = document.getElementById('te-remove-last-btn');
        if (removeBtn) removeBtn.disabled = this.segments.length <= 1;

        // Always rebind drag events after re-rendering handles
        this.bindSplitDragEvents();
    }

    renderSegmentTable() {
        const tbody = document.getElementById('te-segment-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        this.segments.forEach((seg, i) => {
            const tr = document.createElement('tr');
            tr.className = seg.keep ? 'keep' : 'remove';

            const duration = seg.end - seg.start;
            tr.innerHTML = `
                <td>${i + 1}</td>
                <td>${formatTime(seg.start)}</td>
                <td>${formatTime(seg.end)}</td>
                <td>${formatTime(duration)}</td>
                <td>
                    <span class="te-badge ${seg.keep ? 'keep' : 'remove'}"
                          onclick="editor.toggleSegmentFromTable(${i})">
                        ${seg.keep ? 'KEEP' : 'SKIP'}
                    </span>
                </td>
                <td>
                    ${this.segments.length > 1
                        ? `<button class="btn btn-secondary" style="padding:0.2rem 0.5rem;font-size:0.75rem"
                                onclick="editor.previewSegment(${i})">&#9654;</button>`
                        : ''}
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    toggleSegmentFromTable(idx) {
        this.toggleSegment(idx);
        this.renderTimeline();
        this.renderSegmentTable();
        this.updateKeepSummary();
    }

    previewSegment(idx) {
        const seg = this.segments[idx];
        if (!seg) return;
        const preview = document.getElementById('te-preview');
        if (preview) {
            preview.currentTime = seg.start;
            preview.play();
        }
    }

    updateKeepSummary() {
        const kept = this.segments.filter(s => s.keep);
        const keptDur = kept.reduce((sum, s) => sum + (s.end - s.start), 0);
        const el = document.getElementById('te-keep-summary');
        if (el) {
            el.textContent = kept.length === 0
                ? 'No segments selected to keep'
                : `${kept.length} segment${kept.length !== 1 ? 's' : ''} kept · ${formatTime(keptDur)} total`;
        }
    }

    updatePlayhead() {
        const preview = document.getElementById('te-preview');
        if (!preview || !this.videoDuration) return;
        const pct = (preview.currentTime / this.videoDuration) * 100;
        const playhead = document.getElementById('te-playhead');
        if (playhead) playhead.style.left = pct + '%';
    }

    // ─── Timeline Interaction ─────────────────────────────────────────────────

    bindTimelineEvents() {
        const timeline = document.getElementById('te-timeline');
        if (!timeline) return;
        const tooltip  = document.getElementById('te-hover-tooltip');

        // Click timeline → seek video to that position (ignore clicks on split handles)
        timeline.addEventListener('click', (e) => {
            if (this._dragging || !this.videoDuration) return;
            if (e.target.closest('.te-split')) return;
            const rect = timeline.getBoundingClientRect();
            const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const time = pct * this.videoDuration;
            const preview = document.getElementById('te-preview');
            if (preview) preview.currentTime = time;
        });

        // Hover over timeline → show time tooltip
        timeline.addEventListener('mousemove', (e) => {
            if (this._dragging || !this.videoDuration) return;
            const rect = timeline.getBoundingClientRect();
            const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const time = pct * this.videoDuration;
            if (tooltip) {
                tooltip.style.display = 'block';
                tooltip.style.left    = (pct * 100) + '%';
                tooltip.textContent   = formatTime(time);
            }
        });

        timeline.addEventListener('mouseleave', () => {
            if (tooltip) tooltip.style.display = 'none';
        });
    }

    // ─── Public split-control methods ────────────────────────────────────────

    /** Add a split at the current video playback position (called from button). */
    addSplitAtCurrentTime() {
        const preview = document.getElementById('te-preview');
        if (!preview || !this.videoDuration) return;
        this.addSplitAt(preview.currentTime);
        this.renderTimeline();
        this.renderSegmentTable();
        this.updateKeepSummary();
    }

    /** Remove the last-added split point (rightmost). */
    removeLastSplit() {
        if (this.segments.length <= 1) return;
        // Remove the split between the last two segments
        this.removeSplitBetween(this.segments.length - 2);
        this.renderTimeline();
        this.renderSegmentTable();
        this.updateKeepSummary();
    }

    bindSplitDragEvents() {
        const timeline = document.getElementById('te-timeline');
        if (!timeline) return;

        const splits = timeline.querySelectorAll('.te-split');
        splits.forEach(splitEl => {
            splitEl.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const idx = parseInt(splitEl.dataset.splitIndex);
                this._activeSplitIndex = idx;
                this._dragging = true;
                splitEl.classList.add('dragging');

                const onMove = (moveEvent) => {
                    const rect = timeline.getBoundingClientRect();
                    const pct  = (moveEvent.clientX - rect.left) / rect.width;
                    const time = Math.max(0, Math.min(1, pct)) * this.videoDuration;
                    this.moveSplit(idx, time);
                    this.renderTimeline();
                    this.renderSegmentTable();
                    this.updateKeepSummary();
                };

                const onUp = () => {
                    this._dragging = false;
                    this._activeSplitIndex = null;
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };

                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            // Touch support
            splitEl.addEventListener('touchstart', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const idx = parseInt(splitEl.dataset.splitIndex);
                this._activeSplitIndex = idx;
                this._dragging = true;

                const onMove = (moveEvent) => {
                    if (!moveEvent.touches.length) return;
                    const rect = timeline.getBoundingClientRect();
                    const pct  = (moveEvent.touches[0].clientX - rect.left) / rect.width;
                    const time = Math.max(0, Math.min(1, pct)) * this.videoDuration;
                    this.moveSplit(idx, time);
                    this.renderTimeline();
                    this.renderSegmentTable();
                    this.updateKeepSummary();
                };

                const onEnd = () => {
                    this._dragging = false;
                    this._activeSplitIndex = null;
                    document.removeEventListener('touchmove', onMove);
                    document.removeEventListener('touchend', onEnd);
                };

                document.addEventListener('touchmove', onMove, { passive: false });
                document.addEventListener('touchend', onEnd);
            }, { passive: false });
        });
    }

    // ─── FFmpeg Processing ────────────────────────────────────────────────────

    async processVideo() {
        if (!this.selectedVideoId) {
            this.showMessage('Please select a video first.', 'error', 'te-message');
            return;
        }

        const keepSegments = this.segments.filter(s => s.keep);
        if (keepSegments.length === 0) {
            this.showMessage('No segments are marked as KEEP. Toggle at least one segment to keep.', 'error', 'te-message');
            return;
        }

        if (!this.ffmpegMgr.ffmpegLoaded || !this.ffmpegMgr.ffmpeg) {
            this.showMessage('FFmpeg is not loaded yet — please wait a moment and try again.', 'error', 'te-message');
            return;
        }

        if (this.ffmpegMgr.ffmpegBusy) {
            this.showMessage('FFmpeg is busy with another operation. Please wait.', 'info', 'te-message');
            return;
        }

        // Lock immediately — synchronously before any awaits — to prevent double-invocation
        this.ffmpegMgr.ffmpegBusy = true;

        const progressContainer = document.getElementById('te-progress');
        const progressFill      = document.getElementById('te-progress-fill');
        const progressStatus    = document.getElementById('te-progress-status');
        const processBtn        = document.getElementById('te-process-btn');
        const msgEl             = document.getElementById('te-message');

        if (progressContainer) progressContainer.classList.remove('hidden');
        if (processBtn) processBtn.disabled = true;
        if (msgEl) msgEl.classList.add('hidden');

        const setProgress = (pct, label) => {
            if (progressFill) {
                progressFill.style.width = Math.max(1, pct) + '%';
                progressFill.textContent = Math.round(pct) + '%';
            }
            if (progressStatus) progressStatus.textContent = label;
        };

        try {
            setProgress(1, 'Loading video data...');
            const videoData = await this.videoDB.getVideoData(this.selectedVideoId);
            if (!videoData) throw new Error('Video data not found');

            const ext       = videoData.name.match(/\.[^.]+$/)?.[0] || '.mp4';
            const inputName = 'input' + ext;
            const ffmpeg    = this.ffmpegMgr.ffmpeg;
            const n         = keepSegments.length;

            setProgress(2, 'Loading video into FFmpeg...');
            await this.ffmpegMgr.cleanup();
            ffmpeg.FS('writeFile', inputName, new Uint8Array(videoData.data));

            let outputData;

            if (n === 1) {
                // ── Single keep segment ─────────────────────────────────────
                const seg = keepSegments[0];
                setProgress(5, 'Extracting segment...');
                ffmpeg.setProgress(({ ratio }) => setProgress(5 + ratio * 90, 'Extracting...'));

                // Try stream copy first (lossless, fast)
                try {
                    await ffmpeg.run(
                        '-ss', seg.start.toString(),
                        '-i', inputName,
                        '-t', (seg.end - seg.start).toString(),
                        '-c', 'copy',
                        '-avoid_negative_ts', 'make_zero',
                        '-y', 'output.mp4'
                    );
                    const chk = ffmpeg.FS('readFile', 'output.mp4');
                    if (chk && chk.length > 0) outputData = chk;
                } catch (e) {
                    logger.warn('Stream copy failed:', e.message);
                }

                // Re-encode fallback
                if (!outputData) {
                    try {
                        await ffmpeg.run(
                            '-ss', seg.start.toString(),
                            '-i', inputName,
                            '-t', (seg.end - seg.start).toString(),
                            '-c:v', 'libx264', '-preset', 'ultrafast',
                            '-c:a', 'aac',
                            '-avoid_negative_ts', 'make_zero',
                            '-y', 'output.mp4'
                        );
                        const chk = ffmpeg.FS('readFile', 'output.mp4');
                        if (chk && chk.length > 0) outputData = chk;
                    } catch (e) {
                        logger.warn('Re-encode fallback failed:', e.message);
                        throw new Error('Could not extract segment. The video format may not be supported.');
                    }
                }

            } else {
                // ── Multiple keep segments ──────────────────────────────────
                // FFmpeg.wasm 0.11.x WASM state is dirty after any run() exits.
                // Solution: use a fresh FFmpeg instance per operation (each gets
                // clean WASM memory, same as how Simple Cut works for single clips).
                // Browser caches the WASM binary so subsequent load() calls are fast.
                const { createFFmpeg } = window.FFmpeg;
                const makeFreshFFmpeg = async () => {
                    const f = createFFmpeg({
                        log: false,
                        corePath: `${window.location.origin}/js/vendor/ffmpeg-core.js`,
                        mainName: 'main',
                        logger: ({ type, message }) => {
                            if (type !== 'ffout') logger.warn('[FFmpeg]', message);
                        }
                    });
                    await f.load();
                    return f;
                };

                const inputData = new Uint8Array(videoData.data);
                const segBuffers = [];

                // Extract each keep segment with its own fresh FFmpeg instance
                for (let i = 0; i < n; i++) {
                    const seg = keepSegments[i];
                    setProgress((i / (n + 1)) * 80 + 5, `Loading FFmpeg for segment ${i + 1} of ${n}...`);

                    const segFFmpeg = await makeFreshFFmpeg();
                    segFFmpeg.FS('writeFile', inputName, inputData);

                    segFFmpeg.setProgress(({ ratio }) =>
                        setProgress(((i + ratio) / (n + 1)) * 80 + 5, `Extracting segment ${i + 1} of ${n}...`));
                    setProgress(((i + 0.1) / (n + 1)) * 80 + 5, `Extracting segment ${i + 1} of ${n}...`);

                    let segData = null;

                    // Try stream copy first (fast, lossless — same as Simple Cut)
                    try {
                        await segFFmpeg.run(
                            '-ss', seg.start.toString(),
                            '-i',  inputName,
                            '-t',  (seg.end - seg.start).toString(),
                            '-c',  'copy',
                            '-avoid_negative_ts', 'make_zero',
                            '-y',  'seg.mp4'
                        );
                        const chk = segFFmpeg.FS('readFile', 'seg.mp4');
                        if (chk && chk.length > 0) segData = chk;
                    } catch (e) {
                        logger.warn(`Segment ${i + 1} stream copy failed:`, e.message);
                    }

                    // Re-encode fallback
                    if (!segData) {
                        try {
                            await segFFmpeg.run(
                                '-ss', seg.start.toString(),
                                '-i',  inputName,
                                '-t',  (seg.end - seg.start).toString(),
                                '-c:v', 'libx264', '-preset', 'ultrafast',
                                '-c:a', 'aac',
                                '-avoid_negative_ts', 'make_zero',
                                '-y',  'seg.mp4'
                            );
                            const chk = segFFmpeg.FS('readFile', 'seg.mp4');
                            if (chk && chk.length > 0) segData = chk;
                        } catch (e) {
                            logger.warn(`Segment ${i + 1} re-encode failed:`, e.message);
                            throw new Error(`Could not extract segment ${i + 1}. The video format may not be supported.`);
                        }
                    }

                    if (!segData || segData.length === 0) {
                        throw new Error(`Segment ${i + 1} produced empty output. The video format may not be supported.`);
                    }

                    // Free the input copy from this instance to save memory
                    try { segFFmpeg.FS('unlink', inputName); } catch (e) {}
                    segBuffers.push(segData);
                }

                // Concatenate all segments using the concat demuxer (one more fresh instance)
                const pctConcat = (n / (n + 1)) * 80 + 5;
                setProgress(pctConcat, 'Loading FFmpeg for concatenation...');
                const concatFFmpeg = await makeFreshFFmpeg();

                for (let i = 0; i < n; i++) {
                    concatFFmpeg.FS('writeFile', `seg_${i}.mp4`, segBuffers[i]);
                }
                const fileList = segBuffers.map((_, i) => `file 'seg_${i}.mp4'`).join('\n');
                concatFFmpeg.FS('writeFile', 'filelist.txt', new TextEncoder().encode(fileList));

                concatFFmpeg.setProgress(({ ratio }) =>
                    setProgress(pctConcat + ratio * (93 - pctConcat), 'Concatenating...'));
                setProgress(pctConcat + 2, 'Concatenating segments...');

                try {
                    await concatFFmpeg.run(
                        '-f', 'concat', '-safe', '0',
                        '-i', 'filelist.txt',
                        '-c', 'copy',
                        '-y', 'output.mp4'
                    );
                    const chk = concatFFmpeg.FS('readFile', 'output.mp4');
                    if (chk && chk.length > 0) outputData = chk;
                } catch (e) {
                    logger.warn('Concat failed:', e.message);
                    throw new Error('Could not concatenate segments. The video format may not be supported.');
                }
            }

            if (!outputData || outputData.length === 0) {
                throw new Error('Processing produced no output. The video format may not be supported.');
            }

            setProgress(99, 'Saving...');

            const totalKeptDur  = keepSegments.reduce((sum, s) => sum + (s.end - s.start), 0);
            const processedData = {
                originalId:   this.selectedVideoId,
                originalName: videoData.name,
                name:         generateKutName(videoData.name),
                type:         'video/mp4',
                size:         outputData.byteLength || outputData.length,
                duration:     formatTime(totalKeptDur),
                segmentCount: keepSegments.length,
                data:         outputData.buffer || outputData,
                timestamp:    new Date().toISOString()
            };

            await this.videoDB.storeProcessedVideo(processedData);
            setProgress(100, 'Done!');

            setTimeout(() => {
                if (progressContainer) progressContainer.classList.add('hidden');
            }, 1000);

            this.showMessage(
                `Done! ${keepSegments.length} segment${keepSegments.length !== 1 ? 's' : ''} combined into one video.`,
                'success', 'te-message'
            );
            await this.refreshOutput();
            this.switchTab('processed');

        } catch (error) {
            logger.error('Processing failed:', error);
            if (progressContainer) progressContainer.classList.add('hidden');
            this.showMessage('Processing failed: ' + error.message, 'error', 'te-message');
        } finally {
            this.ffmpegMgr.ffmpegBusy = false;
            if (processBtn) processBtn.disabled = false;
            if (this.ffmpegMgr.ffmpeg?.setProgress) this.ffmpegMgr.ffmpeg.setProgress(() => {});
            await this.ffmpegMgr.cleanup().catch(() => {});
        }
    }

    // ─── Output / Processed List ─────────────────────────────────────────────

    async refreshOutput() {
        try {
            const processed = await this.videoDB.getAllProcessed();
            const list  = document.getElementById('te-output-list');
            const empty = document.getElementById('te-output-empty');
            if (!list) return;

            if (processed.length === 0) {
                list.innerHTML = '';
                if (empty) empty.classList.remove('hidden');
                return;
            }

            if (empty) empty.classList.add('hidden');
            list.innerHTML = '';
            const fragment = document.createDocumentFragment();

            processed.forEach(video => {
                const item = document.createElement('li');
                item.className = 'processed-item';
                const pname = escapeHtml(video.name);
                const oname = escapeHtml(video.originalName);
                const segs  = video.segmentCount != null ? ` | ${video.segmentCount} segments` : '';
                item.innerHTML = `
                    <div class="processed-info">
                        <div class="processed-name">${pname}</div>
                        <div class="processed-meta">
                            Duration: ${video.duration}${segs}<br>
                            Size: ${formatBytes(video.size)} |
                            Processed: ${new Date(video.timestamp).toLocaleString()}<br>
                            Original: ${oname}
                        </div>
                    </div>
                    <div class="video-actions">
                        <button class="btn btn-success"   onclick="editor.downloadProcessed(${video.id})">Download</button>
                        <button class="btn btn-secondary" onclick="editor.previewProcessed(${video.id})">Preview</button>
                        <button class="btn btn-danger"    onclick="editor.deleteProcessed(${video.id})">Delete</button>
                    </div>
                `;
                fragment.appendChild(item);
            });

            list.appendChild(fragment);
        } catch (error) {
            logger.error('Error refreshing output:', error);
        }
    }

    async downloadProcessed(id) {
        try {
            const video = await this.videoDB.getProcessedVideo(id);
            if (!video) return;
            const blob = new Blob([video.data], { type: video.type });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url; a.download = video.name;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            logger.error('Download error:', error);
            this.showMessage('Failed to download: ' + error.message, 'error', 'te-message');
        }
    }

    async previewProcessed(id) {
        try {
            const video = await this.videoDB.getProcessedVideo(id);
            if (!video) return;
            const blob = new Blob([video.data], { type: video.type });
            const url  = URL.createObjectURL(blob);
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (error) {
            logger.error('Preview error:', error);
        }
    }

    async deleteProcessed(id) {
        if (!confirm('Delete this processed video?')) return;
        try {
            await this.videoDB.deleteProcessedVideo(id);
            await this.refreshOutput();
        } catch (error) {
            logger.error('Delete error:', error);
            this.showMessage('Failed to delete: ' + error.message, 'error', 'te-message');
        }
    }

    async clearAllProcessed() {
        if (!confirm('Delete ALL processed videos? This cannot be undone.')) return;
        try {
            await this.videoDB.clearStore('processed');
            await this.refreshOutput();
        } catch (error) {
            logger.error('Clear error:', error);
            this.showMessage('Failed to clear: ' + error.message, 'error', 'te-message');
        }
    }

    // ─── Messaging ────────────────────────────────────────────────────────────

    showMessage(message, type, containerId) {
        const el = document.getElementById(containerId);
        if (!el) return;
        el.textContent = message;
        el.className = `status-message status-${type}`;
        el.classList.remove('hidden');
        clearTimeout(this._msgTimer);
        if (type !== 'error') {
            this._msgTimer = setTimeout(() => el.classList.add('hidden'), 6000);
        }
    }
}
