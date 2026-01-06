'use client'

/**
 * Client component that initializes console filtering for browser extension errors.
 * This component should be mounted early in the app to suppress extension noise.
 */
import { useEffect } from 'react'

export function ConsoleFilter() {
  useEffect(() => {
    // Only run in development
    if (process.env.NODE_ENV !== 'development') {
      return
    }

    // List of error patterns to filter out (from browser extensions)
    const FILTER_PATTERNS = [
      /message channel closed/i,
      /chrome\.runtime/i,
      /browser\.runtime/i,
      /moz-extension:/i,
      /chrome-extension:/i,
      /ResumeSwitcher/i,
      /autofillInstance/i,
      /contents\.\w+\.js/i, // Extension content scripts
      /Extension context invalidated/i,
    ]

    // Store original NATIVE console methods BEFORE replacing them
    // This is critical to avoid recursion
    const nativeError = console.error
    const nativeWarn = console.warn
    const nativeLog = console.log
    
    // Verify they are functions
    if (typeof nativeError !== 'function' || 
        typeof nativeWarn !== 'function' || 
        typeof nativeLog !== 'function') {
      // Console methods are not available or invalid, skip filtering
      return
    }
    
    // Create bound versions of native methods for safe calling
    const originalError = nativeError.bind(console)
    const originalWarn = nativeWarn.bind(console)
    const originalLog = nativeLog.bind(console)
    
    // Create safe wrapper functions that handle errors gracefully
    const safeCallError = (...args: any[]) => {
      try {
        // Call the original native method directly
        originalError(...args)
      } catch (e) {
        // Silently fail - don't log errors from the error logger itself
      }
    }
    
    const safeCallWarn = (...args: any[]) => {
      try {
        originalWarn(...args)
      } catch (e) {
        // Silently fail
      }
    }
    
    const safeCallLog = (...args: any[]) => {
      try {
        originalLog(...args)
      } catch (e) {
        // Silently fail
      }
    }

    /**
     * Check if a message should be filtered
     */
    function shouldFilter(args: any[]): boolean {
      try {
        return args.some((arg) => {
          if (typeof arg === 'string') {
            return FILTER_PATTERNS.some((pattern) => pattern.test(arg))
          }
          if (arg?.stack && typeof arg.stack === 'string') {
            return FILTER_PATTERNS.some((pattern) => pattern.test(arg.stack))
          }
          if (arg?.message && typeof arg.message === 'string') {
            return FILTER_PATTERNS.some((pattern) => pattern.test(arg.message))
          }
          return false
        })
      } catch {
        return false
      }
    }

    /**
     * Filter console.error
     */
    console.error = function(...args: any[]) {
      try {
        if (!shouldFilter(args)) {
          safeCallError(...args)
        }
      } catch (err) {
        // Silently fail if console.error is broken
        // This prevents the filter itself from causing errors
      }
    }

    /**
     * Filter console.warn
     */
    console.warn = function(...args: any[]) {
      try {
        if (!shouldFilter(args)) {
          safeCallWarn(...args)
        }
      } catch (err) {
        // Silently fail if console.warn is broken
      }
    }

    /**
     * Filter console.log (only for extension-related noise)
     * Note: We're more conservative with console.log to avoid hiding legitimate logs
     */
    const logPatterns = [
      /ResumeSwitcher/i,
      /autofillInstance/i,
      /Extension context/i,
    ]
    console.log = function(...args: any[]) {
      try {
        const shouldFilterLog = args.some((arg) => {
          if (typeof arg === 'string') {
            return logPatterns.some((pattern) => pattern.test(arg))
          }
          return false
        })
        if (!shouldFilterLog) {
          safeCallLog(...args)
        }
      } catch (err) {
        // Silently fail if console.log is broken
      }
    }

    // Log that filter is active (this won't be filtered)
    try {
      safeCallLog(
        '%c[Console Filter] Extension error filter is active',
        'color: #888; font-style: italic'
      )
    } catch {
      // Ignore if logging fails
    }

    // Cleanup on unmount (restore original native methods)
    return () => {
      try {
        // Restore to original native methods
        console.error = nativeError
        console.warn = nativeWarn
        console.log = nativeLog
      } catch {
        // Ignore cleanup errors
      }
    }
  }, [])

  // This component doesn't render anything
  return null
}

