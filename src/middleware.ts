import { COOKIE_NAME, verifySessionToken } from '@/lib/auth'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/**
 * Paths that must be reachable WITHOUT a valid session.
 * Everything else requires auth.
 */
const PUBLIC_PREFIXES = [
  '/_next/',
  '/api/auth/', // login / logout endpoints
  '/favicon',
  '/icon',
  '/apple-icon',
  '/manifest',
  '/android-chrome',
  '/banner',
  '/logo',
]

const PUBLIC_EXACT = new Set(['/login'])

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true
  }
  // Static file extensions that Next.js serves from /public
  if (/\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|css|js|map|txt|xml|json)$/i.test(pathname)) {
    return true
  }
  return false
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublic(pathname)) {
    return NextResponse.next()
  }

  const token = request.cookies.get(COOKIE_NAME)?.value
  if (token && (await verifySessionToken(token))) {
    return NextResponse.next()
  }

  // Build an ABSOLUTE login URL from the forwarded host. request.nextUrl resolves
  // to the internal localhost:3000 behind Coolify/Traefik, and a RELATIVE Location
  // makes the edge runtime throw ERR_INVALID_URL — so derive the real origin from
  // the proxy headers (Traefik sets X-Forwarded-Host / X-Forwarded-Proto).
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    request.nextUrl.protocol.replace(':', '') ||
    'https'
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host') ||
    request.nextUrl.host
  const loginUrl = new URL('/login', `${proto}://${host}`)
  loginUrl.searchParams.set('from', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  // Run on all paths; the isPublic() check above handles exclusions.
  // Exclude only the raw _next/static and _next/image paths for performance.
  matcher: ['/((?!_next/static|_next/image).*)'],
}
