import { HttpRequest } from "@azure/functions"
import bcrypt from "bcryptjs"
import { describe, expect, it } from "vitest"
import { createSessionCookie, verifySession } from "../src/admin/session"
import type { AppConfig } from "../src/config"
import {
  createAdminLoginHandler,
  createAdminLogoutHandler,
  createRsvpListHandler,
  type AdminDeps,
} from "../src/functions/admin"
import type { RsvpRecord } from "../src/rsvp/model"

const SECRET = "s".repeat(32)
const NOW = new Date("2026-10-18T10:00:00Z")
const DAY_MS = 24 * 60 * 60 * 1000
const NO_STORE = { "Cache-Control": "no-store" }
const PASSCODE = "correct horse"
const CONFIG: AppConfig = {
  storageConnectionString: "UseDevelopmentStorage=true",
  coupleEmails: ["chris@example.com"],
  siteUrl: "https://wedding.example.com",
  adminEmails: ["admin@example.com"],
  adminPasscodeHash: bcrypt.hashSync(PASSCODE, 4),
  sessionSecret: SECRET,
}

function record(name: string, lastUpdatedAt: string, accepts = true) {
  return {
    rowKey: `key-${name}`,
    name,
    email: `${name}@example.com`,
    phone: "",
    attendance: accepts ? "accepts" : "declines",
    partySize: accepts ? 2 : 0,
    message: "",
    firstSubmittedAt: lastUpdatedAt,
    lastUpdatedAt,
    submissionCount: 1,
    previousAttendance: null,
    previousPartySize: null,
    guestEmailStatus: "sent",
    coupleEmailStatus: "sent",
  } as RsvpRecord
}

function setup(
  options: { limited?: boolean; listFails?: boolean; rows?: RsvpRecord[] } = {}
) {
  const errors: string[] = []
  const deps: AdminDeps = {
    store: {
      get: async () => null,
      put: async () => {},
      setEmailStatus: async () => {},
      list: async () => {
        if (options.listFails) throw new Error("boom")
        return options.rows ?? []
      },
    },
    limiter: { isLimited: async () => options.limited ?? false },
    config: () => CONFIG,
    now: () => NOW,
    log: { error: (message) => void errors.push(message) },
  }
  const login = (body: unknown) =>
    createAdminLoginHandler(deps)(
      new HttpRequest({
        method: "POST",
        url: "http://localhost/api/auth/login",
        body: { string: JSON.stringify(body) },
      })
    )
  const logout = () => createAdminLogoutHandler(deps)()
  const list = (cookie?: string) =>
    createRsvpListHandler(deps)(
      new HttpRequest({
        method: "GET",
        url: "http://localhost/api/rsvps",
        headers: cookie ? { cookie } : {},
      })
    )
  return { login, logout, list, errors }
}

describe("admin session", () => {
  const allowed = ["admin@example.com"]
  const cookie = () => createSessionCookie("Admin@Example.com", CONFIG, NOW)

  it("round-trips the email", () => {
    expect(verifySession(cookie(), CONFIG, allowed, NOW)).toBe(
      "admin@example.com"
    )
  })

  it("revokes existing sessions when the passcode hash changes", () => {
    const rotated = { ...CONFIG, adminPasscodeHash: bcrypt.hashSync("new", 4) }
    expect(verifySession(cookie(), rotated, allowed, NOW)).toBeNull()
  })

  it("rejects tampered, expired, delisted, wrong-secret and malformed values", () => {
    const [payload, signature] = cookie().split(".")
    const forged = Buffer.from(
      JSON.stringify({ e: "evil@example.com", exp: NOW.getTime() + DAY_MS })
    ).toString("base64url")
    expect(
      verifySession(`${forged}.${signature}`, CONFIG, allowed, NOW)
    ).toBeNull()
    expect(
      verifySession(
        cookie(),
        CONFIG,
        allowed,
        new Date(NOW.getTime() + 8 * DAY_MS)
      )
    ).toBeNull()
    expect(
      verifySession(cookie(), CONFIG, ["other@example.com"], NOW)
    ).toBeNull()
    expect(
      verifySession(
        cookie(),
        { ...CONFIG, sessionSecret: "x".repeat(32) },
        allowed,
        NOW
      )
    ).toBeNull()
    for (const bad of [undefined, "", "a.b.c", "%%", `${payload}.`]) {
      expect(verifySession(bad, CONFIG, allowed, NOW)).toBeNull()
    }
  })
})

describe("POST /api/auth/login", () => {
  const denied = { message: "That email and passcode don't match." }

  it("sets the session cookie for an allowlisted email in any case", async () => {
    const response = await setup().login({
      email: "Admin@Example.com",
      passcode: PASSCODE,
    })
    expect(response.status).toBe(200)
    expect(response.headers).toEqual(NO_STORE)
    expect(response.cookies?.[0]).toMatchObject({
      name: "cm_admin",
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/",
      maxAge: 604800,
    })
  })

  it("returns the same 401 for a wrong passcode and an unlisted email", async () => {
    const { login } = setup()
    const wrongPasscode = await login({
      email: "admin@example.com",
      passcode: "nope",
    })
    const unlisted = await login({
      email: "stranger@example.com",
      passcode: PASSCODE,
    })
    expect(wrongPasscode.status).toBe(401)
    expect(wrongPasscode.jsonBody).toEqual(denied)
    expect(wrongPasscode.headers).toEqual(NO_STORE)
    expect(unlisted.status).toBe(401)
    expect(unlisted.jsonBody).toEqual(denied)
  })

  it("returns 429 before checking the passcode when limited", async () => {
    const response = await setup({ limited: true }).login({
      email: "admin@example.com",
      passcode: PASSCODE,
    })
    expect(response.status).toBe(429)
    expect(response.cookies).toBeUndefined()
  })

  it("returns 400 for a malformed body", async () => {
    const { login } = setup()
    expect((await login({ email: 1, passcode: "x" })).status).toBe(400)
    expect(
      (await login({ email: "a@b.co", passcode: "x".repeat(201) })).status
    ).toBe(400)
  })
})

describe("POST /api/auth/logout", () => {
  it("expires the cookie", async () => {
    const response = await setup().logout()
    expect(response.status).toBe(200)
    expect(response.cookies?.[0]).toMatchObject({ name: "cm_admin", maxAge: 0 })
  })
})

describe("GET /api/rsvps", () => {
  const validCookie = `other=1; cm_admin=${createSessionCookie("admin@example.com", CONFIG, NOW)}`

  it("rejects requests without a session", async () => {
    const response = await setup().list()
    expect(response.status).toBe(401)
    expect(response.headers).toEqual(NO_STORE)
  })

  it("lists newest first with totals and no rowKey", async () => {
    const rows = [
      record("old", "2026-10-01T00:00:00.000Z"),
      record("new", "2026-10-17T00:00:00.000Z", false),
    ]
    const response = await setup({ rows }).list(validCookie)
    expect(response.status).toBe(200)
    expect(response.headers).toEqual(NO_STORE)
    const body = response.jsonBody as {
      rsvps: Array<Record<string, unknown>>
      totals: unknown
    }
    expect(body.rsvps.map((r) => r.name)).toEqual(["new", "old"])
    expect(body.rsvps[0]).not.toHaveProperty("rowKey")
    expect(body.totals).toEqual({ accepted: 1, guests: 2, declined: 1 })
  })

  it("returns a logged 500 when the store fails", async () => {
    const { list, errors } = setup({ listFails: true })
    expect((await list(validCookie)).status).toBe(500)
    expect(errors).toHaveLength(1)
  })
})
