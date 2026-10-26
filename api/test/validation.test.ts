import { expect, test } from "vitest"
import { validateRsvp } from "../src/rsvp/validation"

const good = {
  name: "  Adaeze Okafor ",
  email: "Adaeze@Example.com",
  phone: "0803 555 0142",
  attendance: "accepts",
  partySize: 2,
  message: "",
  website: "",
}

test("accepts and normalises a valid RSVP", () => {
  const r = validateRsvp(good)
  expect(r).toEqual({
    ok: true,
    honeypot: false,
    value: {
      name: "Adaeze Okafor",
      email: "adaeze@example.com",
      phone: "0803 555 0142",
      attendance: "accepts",
      partySize: 2,
      message: "",
    },
  })
})

test("forces party size 0 when declining", () => {
  expect(
    validateRsvp({ ...good, attendance: "declines", partySize: 3 })
  ).toMatchObject({ ok: true, value: { partySize: 0 } })
})

test.each([
  ["name", { name: "" }],
  ["name", { name: "x".repeat(101) }],
  ["email", { email: "not-an-email" }],
  ["email", { email: `${"a".repeat(250)}@x.io` }],
  ["phone", { phone: "12345" }],
  ["phone", { phone: "0803-555-0142; drop" }],
  ["phone", { phone: "1".repeat(26) }],
  ["attendance", { attendance: "maybe" }],
  ["partySize", { partySize: 0 }],
  ["partySize", { partySize: 4 }],
  ["partySize", { partySize: 1.5 }],
  ["message", { message: "x".repeat(1001) }],
])("rejects bad %s", (field, patch) => {
  const r = validateRsvp({ ...good, ...patch })
  expect(r.ok).toBe(false)
  expect(r.ok === false && r.fieldErrors[field]).toBeTruthy()
})

test.each([
  "https://x.io",
  "evil.com",
  "Ada\u0007",
  "Ada\u202Eeve",
  "Ada\nBcc",
])("rejects name %j", (name) => {
  expect(validateRsvp({ ...good, name })).toEqual({
    ok: false,
    fieldErrors: { name: "Please enter your name using letters only." },
  })
})

test.each([
  "A.B. Okafor",
  "Adaeze O’Neil-Okafor",
  "José Müller",
  "Chris & Miriam",
])("accepts name %j", (name) => {
  expect(validateRsvp({ ...good, name })).toMatchObject({
    ok: true,
    value: { name },
  })
})

test("collapses runs of spaces inside a name", () => {
  expect(validateRsvp({ ...good, name: " Adaeze   Okafor " })).toMatchObject({
    ok: true,
    value: { name: "Adaeze Okafor" },
  })
})

test("rejects non-object bodies", () => {
  expect(validateRsvp(null).ok).toBe(false)
  expect(validateRsvp("x").ok).toBe(false)
})

test("flags filled honeypot", () => {
  expect(validateRsvp({ ...good, website: "spam" })).toMatchObject({
    ok: true,
    honeypot: true,
  })
})
