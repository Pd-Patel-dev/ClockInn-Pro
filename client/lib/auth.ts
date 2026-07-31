import api, { setTokens, clearTokens } from './api'

export interface LoginCredentials {
  email: string
  password: string
}

export interface RegisterData {
  company_name: string
  admin_name: string
  admin_email: string
  admin_password: string
}

export interface User {
  id: string
  company_id: string | null
  name: string
  email: string
  role:
    | 'ADMIN'
    | 'MANAGER'
    | 'DEVELOPER'
    | 'MAINTENANCE'
    | 'FRONTDESK'
    | 'HOUSEKEEPING'
    | 'RESTAURANT'
    | 'SECURITY'
  status: 'active' | 'inactive'
  company_name: string
  email_verified: boolean
  verification_required: boolean
  permissions: string[]
  preferred_name?: string | null
  phone?: string | null
  avatar_url?: string | null
  timezone?: string | null
  date_format?: string
  time_format?: string
  first_day_of_week?: number
  theme_preference?: 'light' | 'dark' | 'system' | string
  created_at?: string | null
  last_verified_at?: string | null
  has_pin?: boolean
}

export interface JwtPayload {
  sub?: string
  company_id?: string | null
  role?: string
  exp?: number
  type?: string
  [key: string]: unknown
}

export function isDeveloperToken(payload: JwtPayload | null | undefined): boolean {
  return payload?.role === 'DEVELOPER'
}

export const login = async (credentials: LoginCredentials) => {
  const response = await api.post('/auth/login', credentials, {
    params: {}, // ensure no query string; credentials must be in body only
  })
  const { access_token } = response.data
  setTokens(access_token)
  return response.data
}

export const register = async (data: RegisterData) => {
  const response = await api.post('/auth/register-company', data)
  const { access_token } = response.data
  setTokens(access_token)
  return response.data
}

export const logout = async () => {
  try {
    await api.post('/auth/logout', {})
  } catch {
    // Ignore errors on logout
  }
  clearTokens()
}

export const getCurrentUser = async (signal?: AbortSignal): Promise<User> => {
  const response = await api.get('/users/me', { signal })
  return response.data
}

