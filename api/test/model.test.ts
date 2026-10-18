import { describe, expect, test } from "vitest"
import {
  computeTotals,
  mergeSubmission,
  rowKeyForEmail,
} from "../src/rsvp/model"

const input = {
  name: "Adaeze Okafor",
  email: "adaeze@example.com",
  phone: "0803 555 0142",
  attendance: "accepts" as const,
  partySize: 2,
  message: "",
}
const t0 = new Date("2026-11-01T10:00:00Z")
const t1 = new Date("2026-11-02T10:00:00Z")

describe("mergeSubmission", () => {
  test("new submission", () => {
    const { record, change } = mergeSubmission(null, input, t0)
    expect(change).toBe("new")
    expect(record).toMatchObject({
      rowKey: rowKeyForEmail("ADAEZE@example.com "),
      submissionCount: 1,
      firstSubmittedAt: t0.toISOString(),
      lastUpdatedAt: t0.toISOString(),
      previousAttendance: null,
      previousPartySize: null,
      guestEmailStatus: "pending",
      coupleEmailStatus: "pending",
    })
  })

  test("changed answer keeps first time and previous answer", () => {
    const first = mergeSubmission(null, input, t0).record
    const { record, change } = mergeSubmission(
      first,
      { ...input, attendance: "declines", partySize: 0 },
      t1
    )
    expect(change).toBe("changed")
    expect(record).toMatchObject({
      submissionCount: 2,
      firstSubmittedAt: t0.toISOString(),
      lastUpdatedAt: t1.toISOString(),
      previousAttendance: "accepts",
      previousPartySize: 2,
      attendance: "declines",
      partySize: 0,
    })
  })

  test("same answer is unchanged", () => {
    const first = mergeSubmission(null, input, t0).record
    expect(
      mergeSubmission(first, { ...input, message: "See you!" }, t1).change
    ).toBe("unchanged")
  })
})

test("totals", () => {
  const a = mergeSubmission(null, input, t0).record
  const b = mergeSubmission(
    null,
    { ...input, email: "b@x.com", partySize: 3 },
    t0
  ).record
  const c = mergeSubmission(
    null,
    { ...input, email: "c@x.com", attendance: "declines", partySize: 0 },
    t0
  ).record
  expect(computeTotals([a, b, c])).toEqual({
    accepted: 2,
    guests: 5,
    declined: 1,
  })
})
