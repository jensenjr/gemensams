import { COOKIE_NAME, createSessionToken, timingSafeEqual } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days in seconds

/** Only allow same-origin relative paths as a post-login destination. */
function safePath(from: string | null | undefined): string {
  return from && from.startsWith('/') && !from.startsWith('//') ? from : '/'
}

/**
 * Reconstruct the external origin from the proxy headers (Coolify/Traefik sets
 * X-Forwarded-Host / X-Forwarded-Proto). Building from request.nextUrl would
 * point at the internal localhost:3000.
 */
function externalOrigin(request: NextRequest): string {
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host') ||
    request.nextUrl.host
  return `${proto}://${host}`
}

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const password = (formData.get('password') as string | null) ?? ''
  const from = (formData.get('from') as string | null) ?? '/'

  const appPassword = process.env.APP_PASSWORD ?? ''
  // Fail closed: if no password is configured, no login is possible.
  const match =
    appPassword.length > 0 && (await timingSafeEqual(password, appPassword))

  const origin = externalOrigin(request)

  if (!match) {
    const loginUrl = new URL('/login', origin)
    const dest = safePath(from)
    if (dest !== '/') loginUrl.searchParams.set('from', dest)
    loginUrl.searchParams.set('error', '1')
    return NextResponse.redirect(loginUrl, 303)
  }

  const token = await createSessionToken()
  const isProduction = process.env.NODE_ENV === 'production'

  const response = NextResponse.redirect(new URL(safePath(from), origin), 303)
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  })
  return response
}
