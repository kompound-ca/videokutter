// Shared Logger — fetches log level from server config

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

export const logger = new Logger();
