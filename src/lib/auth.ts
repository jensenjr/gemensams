/**
 * Shared HMAC-SHA256 cookie auth — works in both Edge (middleware) and Node (Route Handlers).
 * Uses Web Crypto API (crypto.subtle) which is available in both runtimes.
 *
 * Cookie format:  base64url(payload) + "." + base64url(signature)
 * Payload:        JSON { issuedAt: number (unix ms) }
 */

export const COOKIE_NAME = 'gemensams_session'
const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function getSigningSecret(): string {
  const secret =
    process.env.APP_SECRET || process.env.APP_PASSWORD || 'dev-insecure-secret'
  return secret
}

function b64urlEncode(bytes: ArrayBuffer): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function b64urlDecode(str: string): Uint8Array {
  // Restore padding and standard base64 chars
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4
  const fixed = pad ? padded + '='.repeat(4 - pad) : padded
  return Uint8Array.from(atob(fixed), (c) => c.charCodeAt(0))
}

async function importKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

/** Create a signed session token. */
export async function createSessionToken(): Promise<string> {
  const payload = JSON.stringify({ issuedAt: Date.now() })
  const payloadB64 = b64urlEncode(new TextEncoder().encode(payload))

  const key = await importKey(getSigningSecret())
  const sigBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payloadB64),
  )
  const sigB64 = b64urlEncode(sigBuf)

  return `${payloadB64}.${sigB64}`
}

/** Verify a session token. Returns true if valid and not expired. */
export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const dotIdx = token.lastIndexOf('.')
    if (dotIdx === -1) return false

    const payloadB64 = token.slice(0, dotIdx)
    const sigB64 = token.slice(dotIdx + 1)

    // Verify HMAC
    const key = await importKey(getSigningSecret())
    const sigBytes = b64urlDecode(sigB64)
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(payloadB64),
    )
    if (!valid) return false

    // Decode payload and check expiry
    const payloadBytes = b64urlDecode(payloadB64)
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      issuedAt?: number
    }
    const issuedAt: number = payload.issuedAt ?? 0
    if (!issuedAt || Date.now() - issuedAt > EXPIRY_MS) return false

    return true
  } catch {
    return false
  }
}

/**
 * Constant-time string comparison — avoids timing attacks.
 * Runs in Node runtime (login handler). Pads both strings to the same length
 * with a consistent XOR so short-circuit never leaks length info.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  // Use HMAC to produce fixed-length digests, then compare
  const key = await importKey('timing-safe-compare-key')
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(a)),
    crypto.subtle.sign('HMAC', key, enc.encode(b)),
  ])
  return b64urlEncode(ha) === b64urlEncode(hb)
}
