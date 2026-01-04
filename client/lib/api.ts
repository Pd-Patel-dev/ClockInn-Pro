import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

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

// Initialize tokens from localStorage on module load
if (typeof window !== 'undefined') {
  accessToken = localStorage.getItem('access_token')
  refreshToken = localStorage.getItem('refresh_token')
}

export const setTokens = (access: string, refresh: string) => {
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
  if (accessToken) return accessToken
  if (typeof window !== 'undefined') {
    return localStorage.getItem('access_token')
  }
  return null
}

export const getRefreshToken = () => {
  if (refreshToken) return refreshToken
  if (typeof window !== 'undefined') {
    return localStorage.getItem('refresh_token')
  }
  return null
}

// Function to initialize and refresh token if needed
export const initializeAuth = async (): Promise<boolean> => {
  if (typeof window === 'undefined') return false
  
  const storedAccess = localStorage.getItem('access_token')
  const storedRefresh = localStorage.getItem('refresh_token')
  
  if (storedAccess) {
    // Restore tokens from localStorage
    accessToken = storedAccess
    refreshToken = storedRefresh
    return true
  }
  
  // If no access token but we have refresh token, try to refresh
  if (storedRefresh) {
    try {
      const response = await axios.post(`${API_URL}/api/v1/auth/refresh`, {
        refresh_token: storedRefresh,
      }, {
        headers: {
          'Content-Type': 'application/json',
        },
      })
      
      const { access_token, refresh_token } = response.data
      accessToken = access_token
      refreshToken = refresh_token
      setTokens(access_token, refresh_token)
      return true
    } catch (error) {
      // Refresh failed, clear tokens
      clearTokens()
      return false
    }
  }
  
  return false
}

// Request interceptor to add access token
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Always sync token from localStorage before making request
    if (typeof window !== 'undefined' && !accessToken) {
      accessToken = localStorage.getItem('access_token')
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
      console.log('Authorization Header Value:', config.headers.Authorization ? `${config.headers.Authorization.substring(0, 20)}...` : 'MISSING')
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
    if (process.env.NODE_ENV === 'development' && error.response && !error.config?.url?.includes('/auth/refresh')) {
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
      if (!refresh) {
        // No refresh token - clear everything and redirect
        clearTokens()
        processQueue(error, null)
        isRefreshing = false
        refreshPromise = null
        
        // Use window.location for hard redirect (stops all execution)
        if (typeof window !== 'undefined') {
          window.location.href = '/login'
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

            return access_token
          } catch (refreshError: any) {
            // Refresh failed - clear tokens and redirect
            clearTokens()
            processQueue(refreshError as AxiosError, null)
            
            // Use window.location for hard redirect
            if (typeof window !== 'undefined') {
              window.location.href = '/login'
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

