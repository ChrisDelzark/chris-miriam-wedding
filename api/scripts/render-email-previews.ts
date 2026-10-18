import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mergeSubmission } from "../src/rsvp/model"
import { renderCoupleEmail, renderGuestEmail } from "../src/email/templates"

const outDir = join(__dirname, "..", "dist", "previews")
const siteUrl = "https://site.example"
const totals = { accepted: 32, guests: 64, declined: 5 }

const accepted = mergeSubmission(
  null,
  {
    name: "Adaeze Okafor",
    email: "adaeze.okafor@gmail.com",
    phone: "+234 803 555 0142",
    attendance: "accepts",
    partySize: 2,
    message:
      "Can't wait to dance with you both. Makurdi won't know what hit it!",
  },
  new Date()
).record
const declined = { ...accepted, attendance: "declines" as const, partySize: 0 }
const changed = {
  ...declined,
  previousAttendance: "accepts" as const,
  previousPartySize: 2,
}

const previews = {
  "guest-accepts": renderGuestEmail(accepted, siteUrl),
  "guest-declines": renderGuestEmail(declined, siteUrl),
  "couple-new": renderCoupleEmail({
    record: accepted,
    change: "new",
    totals,
    siteUrl,
  }),
  "couple-changed": renderCoupleEmail({
    record: changed,
    change: "changed",
    totals,
    siteUrl,
  }),
}

mkdirSync(outDir, { recursive: true })
for (const [name, email] of Object.entries(previews)) {
  writeFileSync(join(outDir, `${name}.html`), email.html)
  console.log(`${name}: ${email.subject}`)
}
