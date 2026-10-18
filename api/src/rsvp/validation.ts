export type Attendance = "accepts" | "declines"

export type RsvpInput = {
  name: string
  email: string
  phone: string
  attendance: Attendance
  partySize: number
  message: string
}

export type ValidationResult =
  | { ok: true; value: RsvpInput; honeypot: boolean }
  | { ok: false; fieldErrors: Record<string, string> }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_PATTERN = /^[0-9 +()-]+$/
// Names land in email subjects and bodies, so only letters and name
// punctuation are allowed, and anything shaped like a domain is refused.
const NAME_PATTERN = /^[\p{L}\p{M}' ’.,&()\-]+( [\p{L}\p{M}' ’.,&()\-]+)*$/u
const DOMAIN_LIKE_PATTERN = /[\p{L}\p{N}-]{2,}\.\p{L}{2,}/u

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function validateRsvp(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, fieldErrors: { body: "Invalid request." } }
  }
  const input = body as Record<string, unknown>
  const fieldErrors: Record<string, string> = {}

  // Only spaces are collapsed: a newline or tab must still fail the allowlist.
  const name = text(input.name).replace(/ {2,}/g, " ")
  if (name.length < 1 || name.length > 100) {
    fieldErrors.name = "Enter your name (up to 100 characters)."
  } else if (!NAME_PATTERN.test(name) || DOMAIN_LIKE_PATTERN.test(name)) {
    fieldErrors.name = "Please enter your name using letters only."
  }

  const email = text(input.email).toLowerCase()
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    fieldErrors.email = "Enter a valid email address."
  }

  const phone = text(input.phone)
  const phoneDigits = phone.replace(/\D/g, "")
  if (
    phone.length < 7 ||
    phone.length > 25 ||
    !PHONE_PATTERN.test(phone) ||
    phoneDigits.length < 7
  ) {
    fieldErrors.phone = "Enter a valid phone number."
  }

  const attendance = input.attendance
  if (attendance !== "accepts" && attendance !== "declines") {
    fieldErrors.attendance = "Choose whether you will attend."
  }

  let partySize = 0
  if (attendance === "accepts") {
    const size = input.partySize
    if (
      typeof size !== "number" ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > 3
    ) {
      fieldErrors.partySize = "Party size must be 1 to 3."
    } else {
      partySize = size
    }
  }

  const message = text(input.message)
  if (message.length > 1000) {
    fieldErrors.message = "Message must be 1000 characters or fewer."
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors }

  return {
    ok: true,
    honeypot: text(input.website) !== "",
    value: {
      name,
      email,
      phone,
      attendance: attendance as Attendance,
      partySize,
      message,
    },
  }
}
