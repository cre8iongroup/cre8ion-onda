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
 */

// Routes that require authentication
const PROTECTED_PREFIXES = ['/admin', '/tech', '/review']

// Routes that are public (no auth check needed)
const PUBLIC_PREFIXES = ['/session', '/output', '/portal', '/api', '/_next', '/icons', '/manifest.json']

export async function proxy(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl

  // ── v2 Hook: Custom domain / subdomain resolution
  // In v2, populate this from Firebase Remote Config or Firestore Edge Cache.
  // Map hostname → portalSlug, then rewrite to /portal/[slug]
  // Example:
  //   'events.alpfa.org' → 'alpfa'
  //   'onda.clientname.com' → 'clientname'
  //
  // const slugByHostname: Record<string, string> = {}  // v2: populate from config
  // const slug = slugByHostname[hostname]
  // if (slug && pathname === '/') {
  //   return NextResponse.rewrite(new URL(`/portal/${slug}`, request.url))
  // }

  // ── v1: Standard slug routing (App Router handles /portal/[slug] natively)
  // No rewrite needed — App Router resolves /portal/[slug] directly.

  // ── Auth check for protected panel routes
  const isProtected = PROTECTED_PREFIXES.some(prefix => pathname.startsWith(prefix))
  if (!isProtected) return NextResponse.next()

  // Check for Firebase Auth session token in cookies
  // Firebase client SDK stores the auth token in __session cookie when using
  // session cookies, or we check for the existence of a known auth indicator.
  // For App Router with client-side Firebase Auth, we use a custom cookie set
  // on successful sign-in (see AuthContext).
  const sessionCookie = request.cookies.get('onda-session')

  if (!sessionCookie?.value) {
    // Not authenticated — redirect to login with return URL
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
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
