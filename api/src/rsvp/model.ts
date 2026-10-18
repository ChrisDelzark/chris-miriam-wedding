import { createHash } from "node:crypto"
import type { Attendance, RsvpInput } from "./validation"

export type EmailStatus = "pending" | "sent" | "failed"

export type RsvpRecord = RsvpInput & {
  rowKey: string
  firstSubmittedAt: string
  lastUpdatedAt: string
  submissionCount: number
  previousAttendance: Attendance | null
  previousPartySize: number | null
  guestEmailStatus: EmailStatus
  coupleEmailStatus: EmailStatus
}

export type SubmissionChange = "new" | "changed" | "unchanged"

export interface RsvpStore {
  get(rowKey: string): Promise<RsvpRecord | null>
  put(record: RsvpRecord): Promise<void>
  setEmailStatus(
    rowKey: string,
    status: { guestEmailStatus: EmailStatus; coupleEmailStatus: EmailStatus }
  ): Promise<void>
  list(): Promise<RsvpRecord[]>
}

export interface RateLimiter {
  /** Counts this hit and returns true once the count exceeds `limit`. */
  isLimited(
    bucket: string,
    windowSeconds: number,
    limit: number,
    now: Date
  ): Promise<boolean>
}

export function rowKeyForEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex")
}

export function mergeSubmission(
  existing: RsvpRecord | null,
  input: RsvpInput,
  now: Date
): { record: RsvpRecord; change: SubmissionChange } {
  const timestamp = now.toISOString()

  if (existing === null) {
    return {
      change: "new",
      record: {
        ...input,
        rowKey: rowKeyForEmail(input.email),
        firstSubmittedAt: timestamp,
        lastUpdatedAt: timestamp,
        submissionCount: 1,
        previousAttendance: null,
        previousPartySize: null,
        guestEmailStatus: "pending",
        coupleEmailStatus: "pending",
      },
    }
  }

  const answerChanged =
    existing.attendance !== input.attendance ||
    existing.partySize !== input.partySize

  // Both emails are re-sent on every resubmission, so statuses always reset.
  const resubmitted: RsvpRecord = {
    ...existing,
    ...input,
    lastUpdatedAt: timestamp,
    submissionCount: existing.submissionCount + 1,
    guestEmailStatus: "pending",
    coupleEmailStatus: "pending",
  }

  if (!answerChanged) return { change: "unchanged", record: resubmitted }

  return {
    change: "changed",
    record: {
      ...resubmitted,
      previousAttendance: existing.attendance,
      previousPartySize: existing.partySize,
    },
  }
}

export function computeTotals(records: RsvpRecord[]): {
  accepted: number
  guests: number
  declined: number
} {
  let accepted = 0
  let guests = 0
  let declined = 0
  for (const record of records) {
    if (record.attendance === "accepts") {
      accepted += 1
      guests += record.partySize
    } else {
      declined += 1
    }
  }
  return { accepted, guests, declined }
}
