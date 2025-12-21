type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  data?: unknown;
  timestamp: string;
}

class Logger {
  private isDevelopment = import.meta.env.DEV;
  private logLevel: LogLevel = (import.meta.env.VITE_LOG_LEVEL as LogLevel) || 'info';

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  private log(level: LogLevel, message: string, data?: unknown) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
    };

    if (this.isDevelopment) {
      const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
      console[method](`[${level.toUpperCase()}] ${message}`, data || '');
    } else {
      // In production, send to logging service
      // TODO: Implement logging service integration
      // For now, still log errors to console in production
      if (level === 'error') {
        console.error(`[${level.toUpperCase()}] ${message}`, data || '');
      }
    }
  }

  debug(message: string, data?: unknown) {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown) {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown) {
    this.log('warn', message, data);
  }

  error(message: string, error?: Error | unknown) {
    this.log('error', message, error);
  }
}

export const logger = new Logger();

