import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Next.js edge middleware — **SPA-only route gating (not session enforcement)**.
 *
 * **What this does**
 * - Allows listed **public** paths without any server-side auth check.
 * - All other matched paths **pass through** (`NextResponse.next()`). The browser still loads the
 *   app shell; **authentication is enforced in the client** (e.g. `Layout`, `lib/auth.ts`) and by
 *   the **API** (401 when the access token is missing/invalid).
 *
 * **What this does *not* do**
 * - It does **not** validate JWTs at the edge (would require `NEXT_PUBLIC_` or edge-safe secrets,
 *   extra latency, and cookie/http-only refresh design).
 * - It does **not** replace API authorization — never rely on middleware alone for security.
 *
 * **Production hardening options** (if you need real edge protection later)
 * - Session cookie readable by middleware + backend session store, or
 * - BFF pattern / Next.js Route Handlers that proxy to the API with server-side tokens.
 *
 * Public prefixes below must stay in sync with routes that should load without a client redirect
 * to login (e.g. kiosk, punch, auth flows).
 */
export function middleware(request: NextRequest) {
  const publicRoutes = [
    '/login',
    '/register',
    '/verify-email',
    '/set-password',
    '/forgot-password',
    '/punch',
    '/kiosk',
  ]
  const isPublicRoute = publicRoutes.some((route) => request.nextUrl.pathname.startsWith(route))

  if (isPublicRoute) {
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - files with extensions (images, etc.)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:ico|png|jpg|jpeg|svg|gif|webp)).*)',
  ],
}
