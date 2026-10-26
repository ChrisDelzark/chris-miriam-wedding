import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions"
import { checkPasscode } from "../admin/passcode"
import {
  SESSION_COOKIE,
  SESSION_SECONDS,
  createSessionCookie,
  verifySession,
} from "../admin/session"
import { ConfigError, type AppConfig } from "../config"
import { productionDeps } from "../deps"
import { clientIpHash } from "../http/client-ip"
import { computeTotals, type RateLimiter, type RsvpStore } from "../rsvp/model"

export type AdminDeps = {
  store: RsvpStore
  limiter: RateLimiter
  config: () => AppConfig
  now: () => Date
  log: { error(message: string, err?: unknown): void }
}

const LOGIN_WINDOW_SECONDS = 900
const LOGIN_LIMIT = 10
const MAX_EMAIL_LENGTH = 254
const MAX_PASSCODE_LENGTH = 200

// Admin responses carry guest data or session state; no cache may keep them.
const NO_STORE_HEADERS = { "Cache-Control": "no-store" }

const cookieBase = {
  httpOnly: true,
  secure: true,
  sameSite: "Strict" as const,
  path: "/",
}

const serverError = (): HttpResponseInit => ({
  status: 500,
  headers: NO_STORE_HEADERS,
  jsonBody: { message: "Something went wrong. Please try again." },
})

function logFailure(deps: AdminDeps, what: string, error: unknown) {
  if (error instanceof ConfigError) {
    deps.log.error(`Admin configuration error: ${error.message}`)
  } else {
    deps.log.error(what, error)
  }
}

function readCookie(request: HttpRequest, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=")
    if (separator === -1) continue
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim()
    }
  }
  return undefined
}

function parseLogin(body: unknown): { email: string; passcode: string } | null {
  if (typeof body !== "object" || body === null) return null
  const { email, passcode } = body as Record<string, unknown>
  if (typeof email !== "string" || typeof passcode !== "string") return null
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null
  if (passcode.length === 0 || passcode.length > MAX_PASSCODE_LENGTH) {
    return null
  }
  return { email: email.trim().toLowerCase(), passcode }
}

export function createAdminLoginHandler(deps: AdminDeps) {
  return async function adminLoginHandler(
    request: HttpRequest
  ): Promise<HttpResponseInit> {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return {
        status: 400,
        headers: NO_STORE_HEADERS,
        jsonBody: { message: "Request body must be JSON." },
      }
    }
    const login = parseLogin(body)
    if (!login) {
      return {
        status: 400,
        headers: NO_STORE_HEADERS,
        jsonBody: { message: "Enter your email and passcode." },
      }
    }

    try {
      const config = deps.config()
      const limited = await deps.limiter.isLimited(
        `login:${clientIpHash(request)}`,
        LOGIN_WINDOW_SECONDS,
        LOGIN_LIMIT,
        deps.now()
      )
      if (limited) {
        return {
          status: 429,
          headers: NO_STORE_HEADERS,
          jsonBody: { message: "Too many attempts. Please try again later." },
        }
      }

      const listed = config.adminEmails.includes(login.email)
      const passcodeOk = await checkPasscode(
        login.passcode,
        config.adminPasscodeHash
      )
      if (!listed || !passcodeOk) {
        return {
          status: 401,
          headers: NO_STORE_HEADERS,
          jsonBody: { message: "That email and passcode don't match." },
        }
      }

      return {
        status: 200,
        headers: NO_STORE_HEADERS,
        jsonBody: { ok: true },
        cookies: [
          {
            ...cookieBase,
            name: SESSION_COOKIE,
            value: createSessionCookie(login.email, config, deps.now()),
            maxAge: SESSION_SECONDS,
          },
        ],
      }
    } catch (error) {
      logFailure(deps, "Admin login failed", error)
      return serverError()
    }
  }
}

export function createAdminLogoutHandler(_deps: AdminDeps) {
  return async function adminLogoutHandler(): Promise<HttpResponseInit> {
    return {
      status: 200,
      headers: NO_STORE_HEADERS,
      jsonBody: { ok: true },
      cookies: [{ ...cookieBase, name: SESSION_COOKIE, value: "", maxAge: 0 }],
    }
  }
}

export function createRsvpListHandler(deps: AdminDeps) {
  return async function rsvpListHandler(
    request: HttpRequest
  ): Promise<HttpResponseInit> {
    try {
      const config = deps.config()
      const email = verifySession(
        readCookie(request, SESSION_COOKIE),
        config,
        config.adminEmails,
        deps.now()
      )
      if (email === null) {
        return {
          status: 401,
          headers: NO_STORE_HEADERS,
          jsonBody: { message: "Please sign in." },
        }
      }

      const records = await deps.store.list()
      const rsvps = [...records]
        .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))
        .map(({ rowKey: _rowKey, ...rest }) => rest)
      return {
        status: 200,
        headers: NO_STORE_HEADERS,
        jsonBody: { rsvps, totals: computeTotals(records) },
      }
    } catch (error) {
      logFailure(deps, "Listing RSVPs failed", error)
      return serverError()
    }
  }
}

app.http("adminLogin", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "auth/login",
  handler: (request) => createAdminLoginHandler(productionDeps())(request),
})

app.http("adminLogout", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "auth/logout",
  handler: () => createAdminLogoutHandler(productionDeps())(),
})

app.http("rsvpList", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "rsvps",
  handler: (request) => createRsvpListHandler(productionDeps())(request),
})
