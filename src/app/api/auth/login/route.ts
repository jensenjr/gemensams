import { COOKIE_NAME, createSessionToken, timingSafeEqual } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days in seconds

/** Only allow same-origin relative paths as a post-login destination. */
function safePath(from: string | null | undefined): string {
  return from && from.startsWith('/') && !from.startsWith('//') ? from : '/'
}

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const password = (formData.get('password') as string | null) ?? ''
  const from = (formData.get('from') as string | null) ?? '/'

  const appPassword = process.env.APP_PASSWORD ?? ''
  // Fail closed: if no password is configured, no login is possible.
  const match =
    appPassword.length > 0 && (await timingSafeEqual(password, appPassword))

  // IMPORTANT: use RELATIVE Location headers. Building absolute URLs from
  // request.nextUrl resolves to the internal localhost:3000 behind a reverse
  // proxy (Coolify/Traefik); relative paths resolve against the real host.
  if (!match) {
    const params = new URLSearchParams()
    const dest = safePath(from)
    if (dest !== '/') params.set('from', dest)
    params.set('error', '1')
    return new NextResponse(null, {
      status: 303,
      headers: { Location: `/login?${params.toString()}` },
    })
  }

  const token = await createSessionToken()
  const isProduction = process.env.NODE_ENV === 'production'

  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: safePath(from) },
  })
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  })
  return response
}
