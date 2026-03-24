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

/** Build a plain object safe to pass to console.* (no circular refs from Axios, etc.). */
function toSafeLogPayload(error?: Error, context?: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(context && typeof context === 'object' ? { ...context } : {}) }
  if (!error) return out
  out.errorMessage = error.message
  out.errorName = error.name
  const anyErr = error as Error & {
    isAxiosError?: boolean
    response?: { status?: number; data?: unknown }
  }
  if (anyErr.isAxiosError || anyErr.response) {
    out.httpStatus = anyErr.response?.status
    const data = anyErr.response?.data
    if (data !== undefined) {
      try {
        out.responseDetail =
          typeof data === 'string' ? data : JSON.parse(JSON.stringify(data))
      } catch {
        out.responseDetail = String(data)
      }
    }
  }
  return out
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
      if (level === 'error') {
        console.error(logEntry)
      } else if (level === 'warn') {
        console.warn(logEntry)
      } else {
        console.log(logEntry)
      }
      return
    }

    const logEntry = this.formatMessage(level, message, error, context)

    // In development, use console with colors
    if (this.isDevelopment) {
      const styles: Record<LogLevel, string> = {
        debug: 'color: #888',
        info: 'color: #2196F3',
        warn: 'color: #FF9800',
        error: 'color: #F44336; font-weight: bold',
      }
      
      const formattedMessage = `%c[${level.toUpperCase()}] ${message}`
      const style = styles[level]
      // Never pass raw Axios errors to console — DevTools / wrappers can throw on circular structures.
      const additionalData =
        level === 'error' && (error || context)
          ? toSafeLogPayload(error, context)
          : context || ''

      if (level === 'error') {
        console.error(formattedMessage, style, additionalData)
      } else if (level === 'warn') {
        console.warn(formattedMessage, style, additionalData)
      } else {
        console.log(formattedMessage, style, additionalData)
      }
      
      if (error?.stack) {
        try {
          console.error('%cStack', 'color: #888; font-size: 11px', error.stack)
        } catch {
          /* ignore */
        }
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

