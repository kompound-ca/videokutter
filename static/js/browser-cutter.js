/**
 * Browser Video Cutter - Main Application Entry Point
 * This file imports and initializes the video cutter module
 */

// Import the ultra-optimized video cutter with all fixes
import { VideoCutterUltra } from '/js/video-cutter-ultra.js';

// Simple logger wrapper for main entry point
// Will respect LOG_LEVEL from server configuration
const logger = {
    log: async (...args) => {
        try {
            const response = await fetch('/api/config');
            if (response.ok) {
                const config = await response.json();
                if (config.logLevel !== 'error' && config.logLevel !== 'none') {
                    console.log(...args);
                }
            }
        } catch {
            // Default to logging if config fetch fails
            console.log(...args);
        }
    }
};

// Initialize the video cutter application
const cutter = new VideoCutterUltra();

// Make cutter globally available for onclick handlers
window.cutter = cutter;

// Remove preload class after initialization to show content
window.addEventListener('load', () => {
    document.documentElement.classList.remove('preload');
});

// Log initialization status
logger.log('Browser Video Cutter initialized successfully');
logger.log('Using ultra-optimized version with lazy loading');

// Export for potential module usage
export { cutter };
