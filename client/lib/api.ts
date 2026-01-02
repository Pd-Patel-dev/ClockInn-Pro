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
    const token = getAccessToken()
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor to handle token refresh
let isRefreshing = false
let failedQueue: Array<{
  resolve: (value?: any) => void
  reject: (reason?: any) => void
}> = []

const processQueue = (error: AxiosError | null, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error)
    } else {
      prom.resolve(token)
    }
  })
  failedQueue = []
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // Queue the request
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`
            }
            return api(originalRequest)
          })
          .catch((err) => Promise.reject(err))
      }

      originalRequest._retry = true
      isRefreshing = true

      const refresh = getRefreshToken()
      if (!refresh) {
        clearTokens()
        if (typeof window !== 'undefined') {
          window.location.href = '/login'
        }
        return Promise.reject(error)
      }

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

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${access_token}`
        }

        processQueue(null, access_token)
        isRefreshing = false

        return api(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError as AxiosError, null)
        clearTokens()
        if (typeof window !== 'undefined') {
          window.location.href = '/login'
        }
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  }
)

export default api

