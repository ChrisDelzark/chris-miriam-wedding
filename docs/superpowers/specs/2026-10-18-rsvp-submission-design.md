# RSVP submission, storage and emails — design

Date: 2026-10-18
Status: ready for owner approval

## Intent

The invitation site (Chris & Miriam, Saturday 12 December 2026, Sheraton Hotel Makurdi) has an RSVP form, but its only button, "Share RSVP", opens the phone's share sheet or copies text. Nothing is saved, so the couple has no reliable list of who is coming.

This work makes an RSVP a real submission: it is saved, Chris and Miriam can see and export every response, the guest gets a confirmation email, and the couple gets a notification email. Most guests will arrive from a WhatsApp link on a phone, so every part is mobile first.

## Goals

- A guest can submit the RSVP from the existing form and is told clearly whether it worked.
- Every submission is stored durably, in infrastructure separate from the DDS platform.
- Chris and Miriam can view all RSVPs with totals, and download them as CSV.
- The guest receives a confirmation email; Chris and Miriam receive a notification email per RSVP.
- Emails use the chosen design (direction A, "The envelope") and read well on a phone.
- The whole thing can be deleted in one step after the wedding.

## Non-goals

- Guest list, per-guest invite links, or checking who is allowed to RSVP. Anyone with the link can RSVP.
- Party-size limits beyond the form's existing 1–3 stepper.
- A closing date for RSVPs (may be added later; not now).
- A custom domain for the site or for email.
- SMS or automated WhatsApp messages.
- Editing or cancelling an RSVP through a special link. A guest changes their answer by submitting again with the same email.

## Anti-goals (would make this a failure even if it works)

- Any change to the DDS platform's code, database, or deployments.
- Secrets (email connection string, storage keys) in the repo, the page, or logs.
- An RSVP that the guest believes was sent but was not saved.
- Wedding traffic disrupting DDS's own emails (login links, etc.) by exhausting the shared email sending limit.
- The visual invitation experience changing beyond the RSVP button area.

## Decisions made with the owner

| Decision | Choice |
|---|---|
| Where it runs | Separate from the DDS app, inside the DDS **production** Azure subscription |
| Resource grouping | Its own resource group, deletable after the wedding |
| Hosting | Azure Static Web App (moved off GitHub Pages; no invitations have been sent yet, so the URL can change) |
| API | Azure Functions managed by the Static Web App, following the Niarki project's pattern |
| Email service | Reuse the existing DDS Azure Communication Services email configuration, the same way Niarki does |
| Sender address | The existing DDS sender (`DoNotReply@` on the DDS prod mail domain). No new domain. Revisit only if the couple asks |
| Reply-to | Guest emails reply to `chris.ryan.wilkinson@gmail.com` and `miriamtibee3@gmail.com` |
| Couple notifications sent to | `chris.ryan.wilkinson@gmail.com` and `miriamtibee3@gmail.com` |
| Email design | Direction A, "The envelope" — see `assets/2026-10-18-rsvp-email-directions.html` |
| Form button | A new submit button sits **above** the existing "Share RSVP" button; Share stays as a secondary option |
| Who can RSVP | Anyone; ignore party-size control |
| Closing date | None for now |

## Constraints

- **Azure Static Web Apps Free plan.** Managed Functions only (HTTP-triggered, no queues), no SLA. Its built-in sign-in is not used; admin access is handled by the app (see Admin page).
- **Email sending limits are per subscription.** Microsoft's defaults for a custom domain are 30 emails/minute and 100 emails/hour per subscription. The wedding shares this budget with DDS production. Higher limits are available on request (up to 72 hours to approve).
- **The sender's display name is fixed by the ACS MailFrom configuration**, not by the code. The default `DoNotReply` address shows as "DoNotReply". Showing "Chris & Miriam" would need a new MailFrom username with a display name on the DDS mail domain, which Microsoft only allows on custom domains with raised sending limits. The mockups' "From: Chris & Miriam" sender name is therefore not part of this build (see My calls).
- **No secrets in the repo.** All connection strings live in the Static Web App's application settings.
- **Existing site is a single static `index.html` with inline CSS/JS and an `assets/` folder.** Keep that shape; do not introduce a frontend build step.
- **Global code standards apply** (formatting on touched files, no swallowed errors, timeouts on network calls, input validation at trust boundaries, tests for behavior changes).

## How it works

### Request flow

```
Guest phone ── POST /api/rsvp ──► Function "rsvp"
                                   1. validate + honeypot + rate limit
                                   2. upsert row in Table Storage   ── fail → 500, nothing emailed
                                   3. send guest confirmation  ┐ awaited together,
                                   4. send couple notification ┘ capped by a timeout
                                   5. 200 { ok: true }  (even if 3/4 failed; failures logged + recorded on the row)
```

The RSVP counts as received once step 2 succeeds. Email failures never turn a saved RSVP into an error for the guest.

### Data

Azure Table Storage, one table (e.g. `rsvps`).

- One row per guest email: the row key is derived from the lowercased, trimmed email (e.g. a SHA-256 hash), so a repeat submission with the same email **updates** that guest's row ("latest answer wins").
- Fields: name, email, phone, attendance (`accepts` / `declines`), party size (0 when declining), message, first submitted at, last updated at, submission count, guest-email status, couple-email status.
- Totals for the couple (accepted RSVPs, guests coming, declined) are computed by reading the table; volumes are in the hundreds at most.

### API

- `POST /api/rsvp` — anonymous. JSON body. Validates on the server regardless of the browser's checks:
  - name: required, trimmed, 1–100 chars
  - email: required, valid format, ≤ 254 chars
  - phone: required, 7–25 chars, at least 7 digits, only digits/spaces/`+()-`
  - attendance: exactly one of the two form values
  - party size: integer 1–3 when accepting; forced to 0 when declining
  - message: optional, ≤ 1000 chars
  - honeypot: a hidden field that must be empty; if filled, respond as success but store and send nothing
  - rate limit per client IP (hashed), stored in Table Storage
  - Responses: `200 {ok:true}`, `400` with per-field messages, `429` when rate limited, `500` when the save fails. Error bodies never include internal details.
- `POST /api/auth/login` — body `{email, passcode}`. Succeeds only when the email is on the admin allowlist **and** the passcode matches. Sets a signed session cookie. Failed attempts are rate limited per IP.
- `POST /api/auth/logout` — clears the session cookie.
- `GET /api/rsvps` — requires a valid admin session cookie; otherwise `401`. Returns all rows plus totals.

### Admin page

- `/admin/` — a simple mobile-friendly page in the invitation's style: totals at the top, a list of RSVPs (newest first) with name, response, party size, phone (tap to call / WhatsApp), email, and message; a "Download CSV" button.
- Access: a simple sign-in form on `/admin/` asking for email and passcode. No Static Web Apps built-in sign-in or roles.
  - Allowlist: three emails in the `ADMIN_EMAILS` app setting (Chris's, Miriam's and the owner's), compared case-insensitively. Not in the repo.
  - One shared passcode, which the owner hands out. Only its bcrypt hash is stored (`ADMIN_PASSCODE_HASH` app setting).
  - On success the function sets an `HttpOnly`, `Secure`, `SameSite=Strict` cookie holding the email and an expiry (e.g. 7 days), signed with HMAC using `ADMIN_SESSION_SECRET`. `/api/rsvps` checks the signature, expiry, and that the email is still on the allowlist.
  - Failed logins are rate limited per IP (e.g. 5 per 15 minutes) to stop passcode guessing. Error message never says which of email or passcode was wrong.
  - Known limit, accepted for simplicity: the email is a check, not proof of identity, so anyone who knows the passcode and one allowed email can get in. Changing the passcode (new hash in app settings) locks everyone out until they get the new one.
  - The `/admin/` page itself is static and public; it holds no data until the API accepts the session.
- CSV export escapes values that start with `=`, `+`, `-`, `@` so they open safely in Excel or Google Sheets.

### Emails (direction A, "The envelope")

Three templates, each with HTML and plain-text versions, built from email-safe tables with inline styles and no images:

1. **Guest, accepting** — "Thank you, {first name}", their answer and party size, Saturday 12·12·26, Sheraton Hotel · Makurdi, 7:00 AM white wedding ceremony, 2:00 PM traditional wedding reception, colours of the day swatches, "Your presence is our greatest gift", how to reach the couple (reply) and how to change the answer (resubmit with the same email). Subject: "Your RSVP is in — see you on 12 December".
2. **Guest, declining** — same frame, warm "we'll miss you" message, no schedule or colours. Subject to be written in the same voice.
3. **Couple notification** — "{Name} is coming" / "{Name} can't make it", response and party size, email (mailto), phone (tel), message, running totals, buttons "WhatsApp {first name}" (only when the phone number can be turned into a valid `wa.me` link) and "See all RSVPs" (admin page). Subject: "{Name} joyfully accepts (party of N)" or "{Name} regretfully declines". Reply-to: the guest.

All guest-supplied text is HTML-escaped before it goes into a template. Header values (subject, names) have line breaks stripped.

Email code: copy Niarki's `services/email/azure-email.service.ts` approach (lazy client, never logs the connection string) and extend it with `replyTo` and multiple `to` recipients. Sending has a time cap so a slow email service cannot hang the function.

### Form changes (index.html)

- New primary button above "Share RSVP". Proposed label: **"Send RSVP"** (my call; says exactly what happens). "Share RSVP" becomes a quieter secondary button.
- Sending state: button disabled with "Sending…", double taps ignored, request times out after ~15 seconds.
- Success: clear message that the RSVP was sent and a confirmation email is on its way.
- Failure (network, timeout, 5xx): message that it didn't go through, suggesting trying again or using "Share RSVP" so the answer is never lost. 400 errors show the field problems; 429 asks them to wait a few minutes.
- Add the hidden honeypot field.
- Update `og:url`, `og:image`, `og:image:secure_url` and `canonical` to the new Static Web App address so WhatsApp link previews keep working.

### Configuration (Static Web App application settings)

- `AZURE_COMMUNICATION_CONNECTION_STRING` — the DDS prod ACS connection string (same source Niarki uses)
- `AZURE_COMMUNICATION_SENDER_ADDRESS` — the DDS prod sender address
- `COUPLE_EMAILS` — the two Gmail addresses
- `RSVP_STORAGE_CONNECTION_STRING` — the wedding storage account
- `SITE_URL` — public URL, for links in emails
- `ADMIN_EMAILS` — the three allowed admin emails, comma-separated
- `ADMIN_PASSCODE_HASH` — bcrypt hash of the shared passcode
- `ADMIN_SESSION_SECRET` — long random value for signing the admin cookie

### Azure resources (wedding resource group, DDS prod subscription)

- Resource group, e.g. `rg-chris-miriam-wedding`, tagged `project=chris-miriam-wedding`
- Static Web App (Free), linked to the GitHub repo `ChrisDelzark/chris-miriam-wedding` for deploys
- Storage account (Standard LRS) with the `rsvps` table and the rate-limit table (submissions and admin logins)
- No new ACS resources; the existing DDS prod ACS is used via its connection string

### Teardown after the wedding

1. Download the final CSV from the admin page.
2. Delete the resource group (removes the site, functions, storage and all guest data).
3. Remove the deployment token secret from the GitHub repo.
4. Nothing in DDS needs to change, because nothing in DDS was changed.

## Verification

- Function tests (few, focused): validation rejects bad input; same email updates rather than duplicates; email failure still returns success and records the failure; honeypot submissions store nothing; rate limit returns 429; admin login rejects a non-allowlisted email or wrong passcode and `/api/rsvps` rejects missing, tampered or expired cookies.
- Template check: render each template with hostile input (HTML, `<script>`, long text) and confirm it is escaped; view on a phone-width viewport.
- Live check with Playwright at phone width: open invitation → RSVP → Send RSVP → success state; failure state with the API unreachable.
- End-to-end on the deployed app: one real RSVP to a test address, confirm both emails arrive and the admin page shows it.

### Email sending limits

No wedding-specific email cap (owner's decision). Every saved RSVP sends both emails. The subscription's Azure limits (30/min, 100/hr by default, shared with DDS prod) still apply; if Azure throttles a send, that email fails, the row records it as `failed`, and the admin page shows it so the couple can follow up. Accepted risk: a large burst of RSVPs could briefly use the shared hourly budget DDS also relies on. The owner will request higher limits when needed.

The only throttles are the per-IP submission rate limit and the honeypot, which exist to stop spam, not to cap email.

### Repeat submissions

- Matched on email. The row keeps the latest answer, plus the previous attendance and party size and a submission count. Older history is not kept.
- Both emails are sent again. When the answer changed, the couple's subject says so, e.g. "Adaeze Okafor changed their RSVP: now regretfully declines (was party of 2)", and the email shows the previous answer. When nothing material changed, the subject reads "Adaeze Okafor updated their RSVP".

## My calls (owner to check)

- Button label "Send RSVP".
- Repeat RSVPs are matched on email only (not phone); both emails are re-sent and the couple's subject marks it as a change or update.
- Sender: one address, the existing DDS sender with whatever display name DDS has configured (owner's decision: keep DDS email config unless the couple asks). The mockups' "Chris & Miriam" / "Wedding RSVPs" sender names are not part of this build.
- GitHub Pages is switched off (or replaced with a redirect to the new address) once the Static Web App is live, so no one can reach a "Send RSVP" button with no API behind it.
- WhatsApp links assume Nigeria (+234) when a number starts with 0.
- Couple gets one email per RSVP, sent to both addresses in a single message.
- Rate limit numbers and the exact email time cap are left to the builder, but should be modest (10 submissions per IP per hour).
- Azure resources are created manually (not in DDS's Terraform), set up live by the owner and Claude together.

## Left to the builder

- File layout under `api/` and `admin/`, TypeScript setup, test runner.
- How the client IP is read in Static Web Apps managed functions.
- Exact copy for the declining guest email and admin page, in the invitation's voice.
- Deploy pipeline details (GitHub Actions workflow generated by Static Web Apps is fine).

## Answered questions

1. **Email limits:** no cap of any kind on wedding emails. DDS prod stays at Microsoft's default limits; the owner will request an increase when needed.
2. **Admin access:** a simple allowlist of three emails (Chris, Miriam, the owner) plus one shared passcode the owner hands out (see Admin page). No built-in sign-in or roles.
3. **Setup and access:** the owner and Claude set up Azure and GitHub together, live, using computer use, through to a working end-to-end RSVP. Chris (repo owner) is reachable for anything needing GitHub admin on `ChrisDelzark/chris-miriam-wedding`.
4. **Execution:** once the plan is approved, it is executed through to finished in one go, not paused for review after each step.
