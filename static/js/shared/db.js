// Shared IndexedDB wrapper — VideoCutterUltraDB

import { logger } from './logger.js';

const DB_NAME = 'VideoCutterUltraDB';
const DB_VERSION = 1;

export class VideoDB {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

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

    count(storeName) {
        return new Promise((resolve, reject) => {
            const request = this.db.transaction([storeName], 'readonly')
                .objectStore(storeName).count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteVideo(id) {
        const transaction = this.db.transaction(['videos', 'videoMeta'], 'readwrite');
        transaction.objectStore('videos').delete(id);
        transaction.objectStore('videoMeta').delete(id);

        await new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
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

    async deleteProcessedVideo(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['processed'], 'readwrite');
            const request = transaction.objectStore('processed').delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async clearStore(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readwrite');
            tx.objectStore(storeName).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async clearAllVideos() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['videos', 'videoMeta'], 'readwrite');
            tx.objectStore('videos').clear();
            tx.objectStore('videoMeta').clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    async deleteDatabase() {
        this.close();
        return new Promise((resolve) => {
            const req = indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = () => resolve();
            req.onerror   = () => { logger.error('IndexedDB delete error:', req.error); resolve(); };
            req.onblocked = () => { logger.warn('IndexedDB delete blocked (another tab may be open)'); resolve(); };
        });
    }
}
