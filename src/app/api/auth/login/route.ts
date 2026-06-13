import { COOKIE_NAME, createSessionToken, timingSafeEqual } from '@/lib/auth'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { NextRequest, NextResponse } from 'next/server'

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days in seconds

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const password = (formData.get('password') as string | null) ?? ''
  const from = (formData.get('from') as string | null) ?? '/'

  const appPassword = process.env.APP_PASSWORD ?? ''

  const match = await timingSafeEqual(password, appPassword)

  if (!match) {
    // Redirect back to login with error flag
    const loginUrl = new URL('/login', request.nextUrl.origin)
    if (from && from !== '/') loginUrl.searchParams.set('from', from)
    loginUrl.searchParams.set('error', '1')
    return NextResponse.redirect(loginUrl, { status: 303 })
  }

  // Valid password — create signed session cookie
  const token = await createSessionToken()
  const isProduction = process.env.NODE_ENV === 'production'

  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  })

  // Sanitize the redirect destination — only allow same-origin paths
  const destination =
    from && from.startsWith('/') && !from.startsWith('//') ? from : '/'

  redirect(destination)
}
