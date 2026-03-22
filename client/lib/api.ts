import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { isTokenExpiringSoon, isTokenExpired, getTokenExpirationTime } from './tokenManager'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// Token refresh interval (check every 5 minutes)
let tokenRefreshInterval: NodeJS.Timeout | null = null
let refreshWarningShown = false

// Create axios instance (withCredentials so refresh token cookie is sent)
const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
})

/**
 * Access token storage (trade-off documented)
 *
 * **Where:** `access_token` is stored in `localStorage` (and mirrored in memory). The **refresh token** is **not**
 * stored here — it is issued as an **HttpOnly, Secure** cookie and sent automatically (`withCredentials: true`).
 *
 * **Risk:** Any **XSS** on the app origin can execute script and **read `localStorage`**, exfiltrating the current
 * access token. The refresh token remains **not readable by JavaScript**, so XSS alone cannot directly read it
 * (though a compromised page could still trigger authenticated requests in the browser).
 *
 * **Mitigations in place:**
 * - **Short access token lifetime** (e.g. ~15 minutes) — stolen tokens expire quickly; attacker window is limited.
 * - **Refresh token in HttpOnly cookie** — not exposed to JS; rotation/revocation handled server-side.
 * - **No long-term secrets** should depend solely on the access token; treat it as a short-lived session credential.
 * - **Defense in depth:** strict **CSP**, input validation, and **sanitization** of user-controlled content (e.g.
 *   React text escaping, avoid `dangerouslySetInnerHTML` for untrusted data) to reduce XSS likelihood.
 *
 * **Trade-off:** SPAs commonly use memory or `localStorage` for the bearer access token for tab/refresh continuity;
 * alternatives (e.g. BFF-only cookies for access token) change architecture. This project accepts the documented
 * trade-off above with the listed mitigations.
 */
let accessToken: string | null = null

// Helper function to validate JWT token format
const isValidJWTFormat = (token: string | null): boolean => {
  if (!token || typeof token !== 'string') return false
  // JWT tokens have 3 parts separated by dots
  const parts = token.split('.')
  if (parts.length !== 3) return false
  // Each part should be non-empty
  return parts.every(part => part.length > 0)
}

// Initialize tokens from localStorage on module load (access token only; refresh is in HttpOnly cookie)
if (typeof window !== 'undefined') {
  const storedAccess = localStorage.getItem('access_token')

  // Only use tokens if they're in valid JWT format
  if (storedAccess && isValidJWTFormat(storedAccess)) {
    accessToken = storedAccess
  } else if (storedAccess) {
    // Invalid token format, remove it
    localStorage.removeItem('access_token')
  }
}

export const setTokens = (access: string, refresh?: string | null) => {
  // Validate token format before storing (refresh is in cookie, not stored here)
  if (!isValidJWTFormat(access)) {
    console.error('Invalid access token format detected, not storing')
    return
  }

  accessToken = access
  if (typeof window !== 'undefined') {
    localStorage.setItem('access_token', access)
  }
}

export const clearTokens = () => {
  accessToken = null
  if (typeof window !== 'undefined') {
    localStorage.removeItem('access_token')
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

/** Refresh token is in HttpOnly cookie; not readable by JS. Used only to decide whether to call refresh endpoint. */
export const getRefreshToken = (): string | null => {
  return null
}

/**
 * Proactively refresh access token if it's expiring soon.
 * Refresh token is sent via HttpOnly cookie (credentials: 'include').
 */
async function refreshTokenIfNeeded(): Promise<boolean> {
  const currentAccessToken = getAccessToken()

  // If we have a valid access token that's not expiring soon, nothing to do
  if (currentAccessToken && !isTokenExpiringSoon(currentAccessToken, 2)) {
    return true
  }

  // Try to refresh using the HttpOnly cookie (no body)
  try {
    const response = await axios.post(
      `${API_URL}/api/v1/auth/refresh`,
      {},
      {
        headers: { 'Content-Type': 'application/json' },
        withCredentials: true,
      }
    )

    const { access_token } = response.data
    if (!access_token || !isValidJWTFormat(access_token)) {
      clearTokens()
      if (typeof window !== 'undefined') {
        window.location.href = '/login?expired=true'
      }
      return false
    }

    accessToken = access_token
    setTokens(access_token)
    refreshWarningShown = false
    return true
  } catch {
    clearTokens()
    if (typeof window !== 'undefined') {
      window.location.href = '/login?expired=true'
    }
    return false
  }
}

/**
 * Check refresh token expiration and show warning.
 * We cannot read the HttpOnly refresh cookie, so we only warn based on access token expiry or rely on 401 from refresh.
 */
function checkRefreshTokenExpiration(): void {
  if (typeof window === 'undefined') return

  const currentAccessToken = getAccessToken()
  if (!currentAccessToken) return

  // If access token is expired, refresh will be attempted by refreshTokenIfNeeded
  if (isTokenExpired(currentAccessToken)) {
    // Let the next refresh attempt handle redirect
    return
  }

  // Optionally warn when access token is getting close to expiry (session still valid until refresh cookie expires)
  if (isTokenExpiringSoon(currentAccessToken, 5)) {
    const timeUntilExpiry = getTokenExpirationTime(currentAccessToken)
    if (timeUntilExpiry && timeUntilExpiry <= 300 && !refreshWarningShown) {
      console.warn('Your session will refresh shortly. If you are redirected to login, your refresh session may have expired.')
      refreshWarningShown = true
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

  if (storedAccess && isValidJWTFormat(storedAccess)) {
    accessToken = storedAccess

    if (!isTokenExpired(storedAccess)) {
      startTokenRefreshInterval()
      return true
    }
  }

  // No valid access token or expired: try refresh via HttpOnly cookie
  const refreshed = await refreshTokenIfNeeded()
  if (refreshed) {
    startTokenRefreshInterval()
  }
  return refreshed
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
    // Shift notes return 403 when company disables the feature — not an app error
    const isShiftNotesDisabled403 =
      error.response?.status === 403 &&
      typeof originalRequest.url === 'string' &&
      originalRequest.url.includes('shift-notes')
    if (
      process.env.NODE_ENV === 'development' &&
      error.response &&
      !error.config?.url?.includes('/auth/refresh') &&
      !isExpected401 &&
      !isShiftNotesDisabled403
    ) {
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
      const bodyString = responseData ? JSON.stringify(responseData) : ''
      const isVerificationRequired =
        detailError === 'EMAIL_VERIFICATION_REQUIRED' ||
        detail === 'EMAIL_VERIFICATION_REQUIRED' ||
        responseData?.error === 'EMAIL_VERIFICATION_REQUIRED' ||
        bodyString.includes('EMAIL_VERIFICATION_REQUIRED')

      if (isVerificationRequired) {
        // Store verification info in a custom property so login/other pages can redirect
        const customError = error as any
        customError.isVerificationRequired = true
        customError.verificationEmail = (typeof detail === 'object' && detail !== null && 'email' in detail)
          ? detail.email
          : responseData?.email || null
        customError.verificationMessage = (typeof detail === 'object' && detail !== null && 'message' in detail)
          ? detail.message
          : 'Please verify your email to continue.'
        return Promise.reject(error)
      }
    }
    
    // Only handle 401 for non-auth endpoints (prevent infinite loop on refresh endpoint)
    // Do NOT run refresh/redirect for login or register - let the page show the error
    const isAuthEndpoint = originalRequest.url?.includes('/auth/login') ||
      originalRequest.url?.includes('/auth/register')
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/refresh') &&
      !isAuthEndpoint
    ) {
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

      // Refresh token is in HttpOnly cookie; no body needed
      if (!refreshPromise) {
        refreshPromise = (async () => {
          try {
            const response = await axios.post(
              `${API_URL}/api/v1/auth/refresh`,
              {},
              {
                headers: { 'Content-Type': 'application/json' },
                withCredentials: true,
              }
            )

            const { access_token } = response.data
            if (!access_token || !isValidJWTFormat(access_token)) {
              clearTokens()
              processQueue(null, null)
              stopTokenRefreshInterval()
              if (typeof window !== 'undefined') {
                window.location.href = '/login?expired=true'
              }
              throw new Error('Invalid refresh response')
            }

            accessToken = access_token
            setTokens(access_token)
            refreshWarningShown = false
            return access_token
          } catch (refreshError: any) {
            const isExpired =
              refreshError.response?.status === 401 ||
              refreshError.response?.data?.detail?.includes('expired') ||
              refreshError.response?.data?.detail?.includes('Invalid')

            clearTokens()
            processQueue(refreshError as AxiosError, null)
            stopTokenRefreshInterval()

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

