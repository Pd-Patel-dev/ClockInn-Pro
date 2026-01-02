/**
 * Centralized logging utility for the frontend application.
 * Provides structured logging with different log levels.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  error?: Error
  context?: Record<string, any>
  timestamp: string
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development'
  private isProduction = process.env.NODE_ENV === 'production'

  private formatMessage(level: LogLevel, message: string, error?: Error, context?: Record<string, any>): LogEntry {
    return {
      level,
      message,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } as any : undefined,
      context,
      timestamp: new Date().toISOString(),
    }
  }

  private log(level: LogLevel, message: string, error?: Error, context?: Record<string, any>): void {
    if (typeof window === 'undefined') {
      // Server-side rendering - use console
      const logEntry = this.formatMessage(level, message, error, context)
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](logEntry)
      return
    }

    const logEntry = this.formatMessage(level, message, error, context)

    // In development, use console with colors
    if (this.isDevelopment) {
      const styles = {
        debug: 'color: #888',
        info: 'color: #2196F3',
        warn: 'color: #FF9800',
        error: 'color: #F44336; font-weight: bold',
      }
      
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
        `%c[${level.toUpperCase()}] ${message}`,
        styles[level],
        context || error || ''
      )
      
      if (error) {
        console.error('Error details:', error)
      }
    }

    // In production, send to logging service (e.g., Sentry, LogRocket, etc.)
    if (this.isProduction && level === 'error') {
      // TODO: Integrate with production logging service
      // Example: Sentry.captureException(error, { extra: context })
      
      // For now, still log to console in production for critical errors
      console.error('[ERROR]', message, error, context)
    }
  }

  debug(message: string, context?: Record<string, any>): void {
    if (this.isDevelopment) {
      this.log('debug', message, undefined, context)
    }
  }

  info(message: string, context?: Record<string, any>): void {
    this.log('info', message, undefined, context)
  }

  warn(message: string, context?: Record<string, any>): void {
    this.log('warn', message, undefined, context)
  }

  error(message: string, error?: Error, context?: Record<string, any>): void {
    this.log('error', message, error, context)
  }
}

// Export singleton instance
export const logger = new Logger()

// Export default for convenience
export default logger

