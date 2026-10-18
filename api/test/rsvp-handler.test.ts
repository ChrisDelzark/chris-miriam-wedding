import { HttpRequest } from "@azure/functions"
import { describe, expect, it } from "vitest"
import { ConfigError, type AppConfig } from "../src/config"
import type { EmailSender, OutgoingEmail } from "../src/email/email-service"
import { createRsvpHandler, type RsvpDeps } from "../src/functions/rsvp"
import { clientIpHash } from "../src/http/client-ip"
import type { RsvpRecord, RsvpStore } from "../src/rsvp/model"

const COUPLE = ["chris@example.com", "miriam@example.com"]
const CONFIG: AppConfig = {
  storageConnectionString: "UseDevelopmentStorage=true",
  coupleEmails: COUPLE,
  siteUrl: "https://wedding.example.com",
  adminEmails: ["admin@example.com"],
  adminPasscodeHash: "hash",
  sessionSecret: "s".repeat(32),
}

const validBody = {
  name: "Adaeze Okafor",
  email: "adaeze@example.com",
  phone: "+234 803 000 0000",
  attendance: "accepts",
  partySize: 2,
  message: "",
}

function setup(
  overrides: Partial<RsvpDeps> & {
    limited?: boolean
    failSendTo?: string
  } = {}
) {
  const rows = new Map<string, RsvpRecord>()
  const sent: OutgoingEmail[] = []
  const errors: string[] = []
  const store: RsvpStore = {
    get: async (key) => rows.get(key) ?? null,
    put: async (record) => void rows.set(record.rowKey, record),
    setEmailStatus: async (key, status) => {
      const row = rows.get(key)
      if (row) rows.set(key, { ...row, ...status })
    },
    list: async () => [...rows.values()],
  }
  const email: EmailSender = {
    send: async (message) => {
      if (message.to.includes(overrides.failSendTo ?? "\0")) {
        throw new Error("Email send failed")
      }
      sent.push(message)
    },
  }
  const deps: RsvpDeps = {
    store,
    limiter: { isLimited: async () => overrides.limited ?? false },
    email,
    config: () => CONFIG,
    now: () => new Date("2026-10-18T10:00:00Z"),
    log: { error: (message) => void errors.push(message) },
    ...overrides,
  }
  const handler = createRsvpHandler(deps)
  const post = (body: unknown, raw?: string) =>
    handler(
      new HttpRequest({
        method: "POST",
        url: "http://localhost/api/rsvp",
        body: { string: raw ?? JSON.stringify(body) },
        headers: { "x-forwarded-for": "1.2.3.4:5678" },
      })
    )
  return { post, rows, sent, errors }
}

describe("POST /api/rsvp", () => {
  it("saves and emails guest and couple", async () => {
    const { post, rows, sent } = setup()
    const response = await post(validBody)
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({ ok: true })
    expect(rows.size).toBe(1)
    expect(sent).toHaveLength(2)
    const guest = sent.find((m) => m.to.includes("adaeze@example.com"))
    const couple = sent.find((m) => m.to.includes(COUPLE[0]))
    expect(guest?.replyTo).toEqual(COUPLE)
    expect(couple?.to).toEqual(COUPLE)
    expect(couple?.replyTo).toEqual(["adaeze@example.com"])
    const row = [...rows.values()][0]
    expect([row.guestEmailStatus, row.coupleEmailStatus]).toEqual([
      "sent",
      "sent",
    ])
  })

  it("400 with field errors", async () => {
    const { post, rows, sent } = setup()
    const response = await post({ ...validBody, email: "nope" })
    expect(response.status).toBe(400)
    expect(
      (response.jsonBody as { fieldErrors: Record<string, string> }).fieldErrors
        .email
    ).toBeTruthy()
    expect(rows.size).toBe(0)
    expect(sent).toHaveLength(0)
  })

  it("400 on invalid JSON", async () => {
    const { post } = setup()
    const response = await post(null, "{not json")
    expect(response.status).toBe(400)
  })

  it("honeypot pretends success", async () => {
    const { post, rows, sent } = setup()
    const response = await post({ ...validBody, website: "x" })
    expect(response.status).toBe(200)
    expect(rows.size).toBe(0)
    expect(sent).toHaveLength(0)
  })

  it("429 when rate limited", async () => {
    const { post, rows } = setup({ limited: true })
    const response = await post(validBody)
    expect(response.status).toBe(429)
    expect(rows.size).toBe(0)
  })

  it("500 when save fails, nothing sent", async () => {
    const { post, sent, errors } = setup({
      store: {
        get: async () => null,
        put: async () => {
          throw new Error("secret-table-detail")
        },
        setEmailStatus: async () => {},
        list: async () => [],
      },
    })
    const response = await post(validBody)
    expect(response.status).toBe(500)
    expect(JSON.stringify(response.jsonBody)).not.toContain("secret-table")
    expect(sent).toHaveLength(0)
    expect(errors.length).toBeGreaterThan(0)
  })

  it("email failure still succeeds", async () => {
    const { post, rows, errors } = setup({ failSendTo: COUPLE[0] })
    const response = await post(validBody)
    expect(response.status).toBe(200)
    const row = [...rows.values()][0]
    expect([row.guestEmailStatus, row.coupleEmailStatus]).toEqual([
      "sent",
      "failed",
    ])
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join(" ")).not.toContain("adaeze@example.com")
  })

  it("config error is a logged 500", async () => {
    const { post, errors } = setup({
      config: () => {
        throw new ConfigError("Missing settings: COUPLE_EMAILS")
      },
    })
    const response = await post(validBody)
    expect(response.status).toBe(500)
    expect(errors.join(" ")).toContain("COUPLE_EMAILS")
  })

  it("resubmission updates the same row and marks change", async () => {
    const { post, rows, sent } = setup()
    await post(validBody)
    await post({ ...validBody, attendance: "declines", partySize: 0 })
    expect(rows.size).toBe(1)
    expect([...rows.values()][0].submissionCount).toBe(2)
    const coupleSubjects = sent
      .filter((m) => m.to.includes(COUPLE[0]))
      .map((m) => m.subject)
    expect(coupleSubjects[1]).toMatch(/^Adaeze Okafor changed their RSVP/)
  })
})

describe("clientIpHash", () => {
  const request = (headers: Record<string, string>) =>
    new HttpRequest({ method: "POST", url: "http://localhost/x", headers })

  it("strips ports, prefers x-azure-clientip, falls back to unknown", () => {
    const a = clientIpHash(request({ "x-azure-clientip": "1.2.3.4:99" }))
    const b = clientIpHash(request({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }))
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(clientIpHash(request({}))).not.toBe(a)
  })
})
