import { describe, expect, test } from "vitest"
import { mergeSubmission } from "../src/rsvp/model"
import type { RsvpRecord, SubmissionChange } from "../src/rsvp/model"
import { escapeHtml } from "../src/email/escape"
import { renderCoupleEmail, renderGuestEmail } from "../src/email/templates"

const base = mergeSubmission(
  null,
  {
    name: "Adaeze Okafor",
    email: "adaeze@example.com",
    phone: "0803 555 0142",
    attendance: "accepts",
    partySize: 2,
    message: "Can't wait!",
  },
  new Date("2026-11-01T10:00:00Z")
).record
const totals = { accepted: 32, guests: 64, declined: 5 }
const site = "https://site.example"

test("escapeHtml escapes all five characters", () => {
  expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;")
})

test("guest accepting", () => {
  const e = renderGuestEmail(base, site)
  expect(e.subject).toBe("Your RSVP is in — see you on 12 December")
  for (const s of [
    "Thank you, Adaeze",
    "Joyfully accepts, party of 2",
    "SHERATON HOTEL",
    "7:00 AM",
    "2:00 PM",
    "COLOURS OF THE DAY",
    "YOUR PRESENCE IS OUR GREATEST GIFT",
    `href="${site}/"`,
  ]) {
    expect(e.html).toContain(s)
  }
  expect(e.text).toContain("Saturday, 12 December 2026")
})

test("guest declining has no schedule", () => {
  const e = renderGuestEmail(
    { ...base, attendance: "declines", partySize: 0 },
    site
  )
  expect(e.subject).toBe("We'll miss you — Chris & Miriam")
  expect(e.html).not.toContain("7:00 AM")
  expect(e.html).not.toContain("YOUR PRESENCE IS OUR GREATEST GIFT")
})

test.each([
  ["new", {}, "Adaeze Okafor joyfully accepts (party of 2)"],
  [
    "new",
    { attendance: "declines", partySize: 0 },
    "Adaeze Okafor regretfully declines",
  ],
  [
    "changed",
    {
      attendance: "declines",
      partySize: 0,
      previousAttendance: "accepts",
      previousPartySize: 2,
    },
    "Adaeze Okafor changed their RSVP: now regretfully declines (was party of 2)",
  ],
  [
    "changed",
    { partySize: 3, previousAttendance: "accepts", previousPartySize: 2 },
    "Adaeze Okafor changed their RSVP: now joyfully accepts (party of 3, was party of 2)",
  ],
  [
    "changed",
    { previousAttendance: "declines", previousPartySize: 0 },
    "Adaeze Okafor changed their RSVP: now joyfully accepts (party of 2, was declining)",
  ],
  ["unchanged", {}, "Adaeze Okafor updated their RSVP"],
])("couple subject %s", (change, patch, subject) => {
  expect(
    renderCoupleEmail({
      record: { ...base, ...patch } as RsvpRecord,
      change: change as SubmissionChange,
      totals,
      siteUrl: site,
    }).subject
  ).toBe(subject)
})

test("couple email links and totals", () => {
  const e = renderCoupleEmail({
    record: base,
    change: "new",
    totals,
    siteUrl: site,
  })
  expect(e.html).toContain("https://wa.me/2348035550142")
  expect(e.html).toContain(`${site}/admin/`)
  expect(e.html).toContain("32 accepted")
  expect(e.html).toContain("64 guests")
  expect(e.html).toContain('href="tel:08035550142"')
  expect(e.html).toContain('href="mailto:adaeze@example.com"')
})

test("couple email omits the totals line when totals are unavailable", () => {
  const e = renderCoupleEmail({ record: base, change: "new", siteUrl: site })
  expect(e.html).not.toContain("So far:")
  expect(e.text).not.toContain("So far:")
})

test("no WhatsApp button when the number can't be converted", () => {
  expect(
    renderCoupleEmail({
      record: { ...base, phone: "12 34 56 7" },
      change: "new",
      totals,
      siteUrl: site,
    }).html
  ).not.toContain("wa.me")
})

test("hostile guest text is inert everywhere", () => {
  const evil = {
    ...base,
    name: "<img src=x onerror=alert(1)>\r\nBcc: x@y.z",
    message: "<script>alert(1)</script>",
  }
  for (const e of [
    renderGuestEmail(evil, site),
    renderCoupleEmail({
      record: evil,
      change: "new",
      totals,
      siteUrl: site,
    }),
  ]) {
    expect(e.html).not.toMatch(/<img src=x|<script>/)
    expect(e.subject).not.toMatch(/[\r\n]/)
  }
})

test("hostile email and phone cannot break out of href attributes", () => {
  const evil = {
    ...base,
    email: 'a"onmouseover="x@y.z',
    phone: '0803"><b>555 0142',
  }
  const e = renderCoupleEmail({
    record: evil,
    change: "new",
    totals,
    siteUrl: site,
  })
  expect(e.html).not.toContain('"onmouseover=')
  expect(e.html).not.toContain("<b>555")
})
