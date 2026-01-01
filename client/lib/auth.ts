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
  company_id: string
  name: string
  email: string
  role: 'ADMIN' | 'EMPLOYEE'
  status: 'active' | 'inactive'
  company_name: string
}

export const login = async (credentials: LoginCredentials) => {
  const response = await api.post('/auth/login', credentials)
  const { access_token, refresh_token } = response.data
  setTokens(access_token, refresh_token)
  return response.data
}

export const register = async (data: RegisterData) => {
  const response = await api.post('/auth/register-company', data)
  const { access_token, refresh_token } = response.data
  setTokens(access_token, refresh_token)
  return response.data
}

export const logout = async () => {
  const refreshToken = localStorage.getItem('refresh_token')
  if (refreshToken) {
    try {
      await api.post('/auth/logout', { refresh_token: refreshToken })
    } catch (error) {
      // Ignore errors on logout
    }
  }
  clearTokens()
}

export const getCurrentUser = async (): Promise<User> => {
  const response = await api.get('/users/me')
  return response.data
}

