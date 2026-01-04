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

    // Store original console methods - capture them as early as possible
    const originalErrorUnbound = console.error
    const originalWarnUnbound = console.warn
    const originalLogUnbound = console.log
    
    // Verify they are functions
    if (typeof originalErrorUnbound !== 'function' || 
        typeof originalWarnUnbound !== 'function' || 
        typeof originalLogUnbound !== 'function') {
      // Console methods are not available or invalid, skip filtering
      return
    }
    
    // Create safe wrapper functions that handle errors gracefully
    const safeCallError = (...args: any[]) => {
      try {
        originalErrorUnbound.apply(console, args)
      } catch (e) {
        // Silently fail - don't log errors from the error logger itself
      }
    }
    
    const safeCallWarn = (...args: any[]) => {
      try {
        originalWarnUnbound.apply(console, args)
      } catch (e) {
        // Silently fail
      }
    }
    
    const safeCallLog = (...args: any[]) => {
      try {
        originalLogUnbound.apply(console, args)
      } catch (e) {
        // Silently fail
      }
    }

    /**
     * Check if a message should be filtered
     */
    function shouldFilter(args: any[]): boolean {
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

    // Cleanup on unmount (restore original methods)
    return () => {
      try {
        // Restore to original unbound methods
        console.error = originalErrorUnbound
        console.warn = originalWarnUnbound
        console.log = originalLogUnbound
      } catch {
        // Ignore cleanup errors
      }
    }
  }, [])

  // This component doesn't render anything
  return null
}

