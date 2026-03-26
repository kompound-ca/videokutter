// Shared FFmpeg.wasm manager

import { logger } from './logger.js';

export class FFmpegManager {
    constructor() {
        this.ffmpeg = null;
        this.ffmpegLoaded = false;
        this.ffmpegBusy = false;
    }

    async initAsync() {
        if (window.requestIdleCallback) {
            window.requestIdleCallback(() => this.init(), { timeout: 2000 });
        } else {
            setTimeout(() => this.init(), 100);
        }
    }

    async init() {
        try {
            if (typeof window.FFmpeg === 'undefined' || !window.FFmpeg.createFFmpeg) {
                logger.warn('FFmpeg not available');
                return;
            }
            const { createFFmpeg } = window.FFmpeg;
            this.ffmpeg = createFFmpeg({
                log: false,
                corePath: `${window.location.origin}/js/vendor/ffmpeg-core.js`,
                mainName: 'main',
                logger: ({ type, message }) => {
                    if (type === 'fferr') logger.debug('[FFmpeg]', message);
                }
            });
            await this.ffmpeg.load();
            this.ffmpegLoaded = true;
        } catch (error) {
            logger.error('Failed to load FFmpeg.wasm:', error);
            this.ffmpegLoaded = false;
        }
    }

    async cleanup() {
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

}
