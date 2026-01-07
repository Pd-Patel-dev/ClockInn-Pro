import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { isTokenExpiringSoon, isTokenExpired, getTokenExpirationTime } from './tokenManager'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// Token refresh interval (check every 5 minutes)
let tokenRefreshInterval: NodeJS.Timeout | null = null
let refreshWarningShown = false

// Create axios instance
const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Token storage (in-memory + localStorage for persistence)
let accessToken: string | null = null
let refreshToken: string | null = null

// Helper function to validate JWT token format
const isValidJWTFormat = (token: string | null): boolean => {
  if (!token || typeof token !== 'string') return false
  // JWT tokens have 3 parts separated by dots
  const parts = token.split('.')
  if (parts.length !== 3) return false
  // Each part should be non-empty
  return parts.every(part => part.length > 0)
}

// Initialize tokens from localStorage on module load
if (typeof window !== 'undefined') {
  const storedAccess = localStorage.getItem('access_token')
  const storedRefresh = localStorage.getItem('refresh_token')
  
  // Only use tokens if they're in valid JWT format
  if (storedAccess && isValidJWTFormat(storedAccess)) {
    accessToken = storedAccess
  } else if (storedAccess) {
    // Invalid token format, remove it
    localStorage.removeItem('access_token')
  }
  
  if (storedRefresh && isValidJWTFormat(storedRefresh)) {
    refreshToken = storedRefresh
  } else if (storedRefresh) {
    // Invalid token format, remove it
    localStorage.removeItem('refresh_token')
  }
}

export const setTokens = (access: string, refresh: string) => {
  // Validate token format before storing
  if (!isValidJWTFormat(access) || !isValidJWTFormat(refresh)) {
    console.error('Invalid token format detected, not storing tokens')
    return
  }
  
  accessToken = access
  refreshToken = refresh
  // Store both tokens in localStorage for persistence
  if (typeof window !== 'undefined') {
    localStorage.setItem('access_token', access)
    localStorage.setItem('refresh_token', refresh)
  }
}

export const clearTokens = () => {
  accessToken = null
  refreshToken = null
  if (typeof window !== 'undefined') {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
  }
}

export const getAccessToken = () => {
  if (accessToken && isValidJWTFormat(accessToken)) return accessToken
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('access_token')
    if (stored && isValidJWTFormat(stored)) {
      return stored
    } else if (stored) {
      // Invalid token, remove it
      localStorage.removeItem('access_token')
    }
  }
  return null
}

export const getRefreshToken = () => {
  if (refreshToken && isValidJWTFormat(refreshToken)) return refreshToken
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('refresh_token')
    if (stored && isValidJWTFormat(stored)) {
      return stored
    } else if (stored) {
      // Invalid token, remove it
      localStorage.removeItem('refresh_token')
    }
  }
  return null
}

/**
 * Proactively refresh access token if it's expiring soon
 */
async function refreshTokenIfNeeded(): Promise<boolean> {
  const currentAccessToken = getAccessToken()
  const currentRefreshToken = getRefreshToken()

  if (!currentAccessToken || !currentRefreshToken) {
    return false
  }

  // Check if access token is expiring soon (within 2 minutes) or expired
  if (!isTokenExpiringSoon(currentAccessToken, 2)) {
    return true // Token is still valid
  }

  // Check if refresh token is expired
  if (isTokenExpired(currentRefreshToken)) {
    clearTokens()
    if (typeof window !== 'undefined') {
      window.location.href = '/login?expired=true'
    }
    return false
  }

  // Proactively refresh the access token
  try {
    const response = await axios.post(`${API_URL}/api/v1/auth/refresh`, {
      refresh_token: currentRefreshToken,
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const { access_token, refresh_token } = response.data
    accessToken = access_token
    refreshToken = refresh_token
    setTokens(access_token, refresh_token)
    
    // Reset warning flag when token is refreshed
    refreshWarningShown = false
    
    return true
  } catch (error) {
    // Refresh failed - clear tokens and redirect
    clearTokens()
    if (typeof window !== 'undefined') {
      window.location.href = '/login?expired=true'
    }
    return false
  }
}

/**
 * Check refresh token expiration and show warning
 */
function checkRefreshTokenExpiration(): void {
  if (typeof window === 'undefined') return

  const currentRefreshToken = getRefreshToken()
  if (!currentRefreshToken) return

  // Check if refresh token is expiring soon (within 1 day)
  if (isTokenExpiringSoon(currentRefreshToken, 24 * 60)) {
    const timeUntilExpiry = getTokenExpirationTime(currentRefreshToken)
    if (timeUntilExpiry && !refreshWarningShown) {
      const hoursUntilExpiry = Math.floor(timeUntilExpiry / 3600)
      const daysUntilExpiry = Math.floor(hoursUntilExpiry / 24)

      if (daysUntilExpiry <= 1 && hoursUntilExpiry <= 24) {
        // Show warning notification (non-blocking)
        console.warn(
          `⚠️ Your session will expire in ${daysUntilExpiry > 0 ? `${daysUntilExpiry} day(s)` : `${hoursUntilExpiry} hour(s)`}. Please save your work and consider logging in again.`
        )
        refreshWarningShown = true
      }
    }
  }

  // Check if refresh token is expired
  if (isTokenExpired(currentRefreshToken)) {
    clearTokens()
    if (typeof window !== 'undefined') {
      window.location.href = '/login?expired=true'
    }
  }
}

/**
 * Start proactive token refresh interval
 */
export function startTokenRefreshInterval(): void {
  if (typeof window === 'undefined') return
  
  // Clear existing interval if any
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval)
  }

  // Check and refresh token every 5 minutes
  tokenRefreshInterval = setInterval(() => {
    refreshTokenIfNeeded()
    checkRefreshTokenExpiration()
  }, 5 * 60 * 1000) // 5 minutes

  // Also check immediately
  refreshTokenIfNeeded()
  checkRefreshTokenExpiration()
}

/**
 * Stop proactive token refresh interval
 */
export function stopTokenRefreshInterval(): void {
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval)
    tokenRefreshInterval = null
  }
}

// Function to initialize and refresh token if needed
export const initializeAuth = async (): Promise<boolean> => {
  if (typeof window === 'undefined') return false
  
  const storedAccess = localStorage.getItem('access_token')
  const storedRefresh = localStorage.getItem('refresh_token')
  
  // Validate token format before using
  if (storedAccess && isValidJWTFormat(storedAccess) && storedRefresh && isValidJWTFormat(storedRefresh)) {
    // Restore tokens from localStorage
    accessToken = storedAccess
    refreshToken = storedRefresh
    
    // Check if tokens are expired
    if (isTokenExpired(storedAccess)) {
      // Access token expired, try to refresh
      if (storedRefresh && !isTokenExpired(storedRefresh)) {
        return await refreshTokenIfNeeded()
      } else {
        // Both expired, clear and return false
        clearTokens()
        return false
      }
    }
    
    // Start proactive refresh interval
    startTokenRefreshInterval()
    return true
  }
  
  // If no access token but we have refresh token, try to refresh
  if (storedRefresh && !isTokenExpired(storedRefresh)) {
    const refreshed = await refreshTokenIfNeeded()
    if (refreshed) {
      startTokenRefreshInterval()
    }
    return refreshed
  }
  
  return false
}

    // Request interceptor to add access token
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Note: We don't await token refresh here to avoid blocking requests
    // Token refresh happens proactively in the background via interval
    // If token is expired, the response interceptor will handle it
    
    // Always sync token from localStorage before making request
    if (typeof window !== 'undefined' && !accessToken) {
      const stored = localStorage.getItem('access_token')
      if (stored && isValidJWTFormat(stored)) {
        accessToken = stored
      }
    }
    
    const token = getAccessToken()
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    } else {
      // Token missing - log warning for shift creation requests
      if (process.env.NODE_ENV === 'development' && config.url?.includes('/shifts') && config.method === 'post') {
        console.warn('=== WARNING: NO TOKEN AVAILABLE FOR SHIFT CREATE REQUEST ===')
        console.warn('This request will likely fail with 401 unless token is refreshed')
      }
    }
    
    // Log shift creation requests with full details
    if (process.env.NODE_ENV === 'development' && config.url?.includes('/shifts') && config.method === 'post') {
      console.log('=== AXIOS REQUEST INTERCEPTOR (SHIFT CREATE) ===')
      console.log('Final URL:', config.url)
      console.log('Base URL:', config.baseURL)
      console.log('Full URL:', `${config.baseURL}${config.url}`)
      console.log('Method:', config.method?.toUpperCase())
      console.log('Has Authorization Header:', !!config.headers.Authorization)
      const authHeader = config.headers.Authorization
      const authHeaderStr = typeof authHeader === 'string' ? authHeader : (Array.isArray(authHeader) ? authHeader[0] : String(authHeader || ''))
      console.log('Authorization Header Value:', authHeaderStr ? `${authHeaderStr.substring(0, 20)}...` : 'MISSING')
      console.log('Token Available:', !!token)
      console.log('Request Headers:', JSON.stringify(config.headers, null, 2))
    }
    
    // Reduced logging - only log important requests to prevent spam
    if (process.env.NODE_ENV === 'development' && config.url?.includes('/auth/refresh')) {
      console.log('=== TOKEN REFRESH REQUEST ===')
    }
    
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor to handle token refresh
let isRefreshing = false
let refreshPromise: Promise<string> | null = null
let failedQueue: Array<{
  resolve: (value?: any) => void
  reject: (reason?: any) => void
  request: InternalAxiosRequestConfig & { _retry?: boolean }
}> = []

const processQueue = (error: AxiosError | null, token: string | null = null) => {
  failedQueue.forEach(({ resolve, reject, request }) => {
    if (error) {
      reject(error)
    } else if (token) {
      // Update the request with the new token and resolve with a retry promise
      if (request.headers) {
        request.headers.Authorization = `Bearer ${token}`
      }
      // Resolve with the retry promise so the original request is retried
      resolve(api(request))
    } else {
      reject(new Error('No token available'))
    }
  })
  failedQueue = []
}

api.interceptors.response.use(
  (response) => {
    // Log successful responses for debugging (only in development, and only important ones)
    if (process.env.NODE_ENV === 'development' && response.config.url?.includes('/auth/refresh')) {
      console.log('=== TOKEN REFRESH SUCCESS ===')
    }
    return response
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }
    
    // Detailed logging for shift creation 401 errors
    if (process.env.NODE_ENV === 'development' && error.response?.status === 401 && originalRequest.url?.includes('/shifts')) {
      console.error('=== AXIOS ERROR RESPONSE (SHIFT CREATE) ===')
      console.error('URL:', originalRequest.url)
      console.error('Full URL:', `${originalRequest.baseURL}${originalRequest.url}`)
      console.error('Method:', originalRequest.method?.toUpperCase())
      console.error('Status:', error.response.status)
      console.error('Status Text:', error.response.statusText)
      console.error('Has _retry flag:', !!originalRequest._retry)
      console.error('Request Headers:', JSON.stringify(originalRequest.headers, null, 2))
      console.error('Has Authorization Header:', !!originalRequest.headers?.Authorization)
      console.error('Response Data:', JSON.stringify(error.response?.data, null, 2))
      console.error('Is Retrying:', !!originalRequest._retry)
    }
    
    // Log error responses for debugging (limit to prevent spam)
    // Skip logging expected 401s from /users/me (normal when not logged in)
    const isExpected401 = error.response?.status === 401 && originalRequest.url?.includes('/users/me')
    if (process.env.NODE_ENV === 'development' && error.response && !error.config?.url?.includes('/auth/refresh') && !isExpected401) {
      // Only log first few errors to prevent spam
      if (!(window as any).__errorLogCount) {
        (window as any).__errorLogCount = 0
      }
      if ((window as any).__errorLogCount < 5 && !originalRequest.url?.includes('/shifts')) {
        console.error('=== AXIOS ERROR RESPONSE ===')
        console.error('URL:', error.config?.url)
        console.error('Status:', error.response.status)
        ;(window as any).__errorLogCount++
      }
    }

    // Handle email verification required (403 with specific error)
    // FastAPI returns detail as an object with error, message, and email fields
    if (error.response?.status === 403) {
      const responseData = error.response?.data as any
      const detail = responseData?.detail
      const detailError = (typeof detail === 'object' && detail !== null && 'error' in detail) 
        ? detail.error 
        : null
      const isVerificationRequired = 
        detailError === 'EMAIL_VERIFICATION_REQUIRED' ||
        detail === 'EMAIL_VERIFICATION_REQUIRED' ||
        responseData?.error === 'EMAIL_VERIFICATION_REQUIRED'
      
      if (isVerificationRequired) {
        // Store verification info in a custom property
        const customError = error as any
        customError.isVerificationRequired = true
        // Extract email from detail object or fallback to response data
        customError.verificationEmail = (typeof detail === 'object' && detail !== null && 'email' in detail)
          ? detail.email
          : responseData?.email || null
        // Also store the message for better UX
        customError.verificationMessage = (typeof detail === 'object' && detail !== null && 'message' in detail)
          ? detail.message
          : 'Please verify your email to continue.'
        return Promise.reject(error)
      }
    }
    
    // Only handle 401 for non-auth endpoints (prevent infinite loop on refresh endpoint)
    if (error.response?.status === 401 && !originalRequest._retry && !originalRequest.url?.includes('/auth/refresh')) {
      if (process.env.NODE_ENV === 'development' && originalRequest.url?.includes('/shifts')) {
        console.log('=== HANDLING 401 FOR SHIFT CREATE ===')
        console.log('Already Refreshing:', isRefreshing)
        console.log('Has Refresh Promise:', !!refreshPromise)
        console.log('Token Before Refresh:', !!getAccessToken())
      }
      
      // If already refreshing, queue this request
      if (isRefreshing && refreshPromise) {
        if (process.env.NODE_ENV === 'development' && originalRequest.url?.includes('/shifts')) {
          console.log('=== QUEUING SHIFT CREATE REQUEST (REFRESH IN PROGRESS) ===')
        }
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject, request: originalRequest })
        }).catch((err) => Promise.reject(err))
      }

      // Mark request as retried to prevent loops
      originalRequest._retry = true
      isRefreshing = true

      const refresh = getRefreshToken()
      if (!refresh || isTokenExpired(refresh)) {
        // No refresh token or expired - clear everything and redirect
        clearTokens()
        stopTokenRefreshInterval()
        processQueue(error, null)
        isRefreshing = false
        refreshPromise = null
        
        // Use window.location for hard redirect (stops all execution)
        if (typeof window !== 'undefined') {
          window.location.href = '/login?expired=true'
        }
        return Promise.reject(error)
      }

      // Create refresh promise if it doesn't exist
      if (!refreshPromise) {
        refreshPromise = (async () => {
          try {
            const response = await axios.post(`${API_URL}/api/v1/auth/refresh`, {
              refresh_token: refresh,
            }, {
              headers: {
                'Content-Type': 'application/json',
              },
            })

            const { access_token, refresh_token } = response.data
            accessToken = access_token
            refreshToken = refresh_token
            setTokens(access_token, refresh_token)

            // Reset warning flag
            refreshWarningShown = false

            return access_token
          } catch (refreshError: any) {
            // Refresh failed - check if refresh token expired
            const isExpired = refreshError.response?.status === 401 || 
                             refreshError.response?.data?.detail?.includes('expired') ||
                             refreshError.response?.data?.detail?.includes('Invalid')
            
            clearTokens()
            processQueue(refreshError as AxiosError, null)
            stopTokenRefreshInterval()
            
            // Use window.location for hard redirect with expired flag
            if (typeof window !== 'undefined') {
              window.location.href = isExpired ? '/login?expired=true' : '/login'
            }
            
            throw refreshError
          } finally {
            isRefreshing = false
            refreshPromise = null
          }
        })()
      }

      try {
        const access_token = await refreshPromise

        // Update the original request with new token
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${access_token}`
        }

        // Process queued requests
        processQueue(null, access_token)

        // Retry the original request
        if (process.env.NODE_ENV === 'development' && originalRequest.url?.includes('/shifts')) {
          console.log('=== RETRYING SHIFT CREATE AFTER TOKEN REFRESH ===')
          console.log('New Token Available:', !!access_token)
        }
        return api(originalRequest)
      } catch (refreshError) {
        // Refresh failed - already handled in promise
        return Promise.reject(refreshError)
      }
    }

    // For 401 on auth endpoints or other errors, just reject
    return Promise.reject(error)
  }
)

export default api

