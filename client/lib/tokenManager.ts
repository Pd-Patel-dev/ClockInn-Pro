/**
 * Token Manager - Handles proactive token refresh and expiration warnings
 */

interface TokenPayload {
  exp: number
  sub: string
  type: string
  [key: string]: any
}

/**
 * Decode JWT token without verification (for checking expiration)
 */
function decodeJWT(token: string): TokenPayload | null {
  try {
    const base64Url = token.split('.')[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    )
    return JSON.parse(jsonPayload)
  } catch (error) {
    return null
  }
}

/**
 * Check if token is expired or will expire soon
 */
function isTokenExpiringSoon(token: string, bufferMinutes: number = 2): boolean {
  const payload = decodeJWT(token)
  if (!payload || !payload.exp) return true

  const expirationTime = payload.exp * 1000 // Convert to milliseconds
  const now = Date.now()
  const bufferMs = bufferMinutes * 60 * 1000

  return expirationTime - now < bufferMs
}

/**
 * Check if token is expired
 */
function isTokenExpired(token: string): boolean {
  const payload = decodeJWT(token)
  if (!payload || !payload.exp) return true

  const expirationTime = payload.exp * 1000
  return Date.now() >= expirationTime
}

/**
 * Get time until token expires (in seconds)
 */
function getTokenExpirationTime(token: string): number | null {
  const payload = decodeJWT(token)
  if (!payload || !payload.exp) return null

  const expirationTime = payload.exp * 1000
  const now = Date.now()
  return Math.max(0, Math.floor((expirationTime - now) / 1000))
}

export { decodeJWT, isTokenExpiringSoon, isTokenExpired, getTokenExpirationTime }

