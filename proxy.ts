import { NextResponse, type NextRequest } from 'next/server'

/**
 * Onda Middleware — Route Protection & Multi-Tenancy
 *
 * v1: Slug-based routing at cre8ion-onda.app/[slug]
 * v2 hook: Hostname inspection is already here — to enable custom domain/subdomain
 *          support in v2, populate the SLUG_BY_HOSTNAME mapping from Firestore KV
 *          (or Edge Config) and the rewrite logic below will handle it without
 *          requiring a re-architecture of routes.
 *
 * Protected panel routes require a valid Firebase Auth session cookie.
 * We do a lightweight check here — actual user doc + capability validation
 * happens in each panel's server component layout.
 *
 * Attendee and output views are fully public — no auth check.
 * Canonical show home: /show/[slug]. Legacy /portal/[slug] redirects there.
 * Output Windows: /output/[roomId]/[windowIndex] (controls-free OBS targets).
 */

// Routes that require authentication
const PROTECTED_PREFIXES = ['/admin', '/tech', '/review']

// Public exceptions inside otherwise-protected prefixes
const PUBLIC_EXACT = ['/tech/login']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── v2 Hook: Custom domain / subdomain resolution
  // In v2, populate this from Firebase Remote Config or Firestore Edge Cache.
  // Map hostname → portalSlug, then rewrite to /portal/[slug]

  // Tech credential login must be reachable without onda-session
  if (PUBLIC_EXACT.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next()
  }

  // ── Auth check for protected panel routes
  const isProtected = PROTECTED_PREFIXES.some(prefix => pathname.startsWith(prefix))
  if (!isProtected) return NextResponse.next()

  const sessionCookie = request.cookies.get('onda-session')

  if (!sessionCookie?.value) {
    const loginUrl = new URL(
      pathname.startsWith('/tech') ? '/tech/login' : '/login',
      request.url
    )
    if (!pathname.startsWith('/tech')) {
      loginUrl.searchParams.set('from', pathname)
    } else {
      loginUrl.searchParams.set('from', pathname)
    }
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - Public file extensions
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2|woff|ttf)$).*)',
  ],
}
