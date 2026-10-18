import { createHmac, timingSafeEqual } from "node:crypto"

export const SESSION_COOKIE = "cm_admin"
export const SESSION_SECONDS = 7 * 24 * 60 * 60

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest()
}

export function createSessionCookie(
  email: string,
  secret: string,
  now: Date
): string {
  const payload = Buffer.from(
    JSON.stringify({
      e: email.trim().toLowerCase(),
      exp: now.getTime() + SESSION_SECONDS * 1000,
    })
  ).toString("base64url")
  return `${payload}.${sign(payload, secret).toString("base64url")}`
}

// Returns the signed-in email, or null for any invalid, expired or revoked session.
export function verifySession(
  cookieValue: string | undefined,
  secret: string,
  allowedEmails: string[],
  now: Date
): string | null {
  if (!cookieValue) return null
  const parts = cookieValue.split(".")
  if (parts.length !== 2) return null
  const [payload, signature] = parts

  const given = Buffer.from(signature, "base64url")
  const expected = sign(payload, secret)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null
  }

  try {
    const data: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    )
    if (typeof data !== "object" || data === null) return null
    const { e, exp } = data as { e?: unknown; exp?: unknown }
    if (typeof e !== "string" || typeof exp !== "number") return null
    if (exp <= now.getTime()) return null
    const email = e.toLowerCase()
    return allowedEmails.includes(email) ? email : null
  } catch {
    return null
  }
}
