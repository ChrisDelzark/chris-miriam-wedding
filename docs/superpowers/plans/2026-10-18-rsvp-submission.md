# RSVP Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the invitation's RSVP form into a real submission that is saved in Azure Table Storage, emails the guest and the couple (design A), and is viewable/exportable on a passcode-protected admin page, hosted on an Azure Static Web App.

**Architecture:** The static site (`index.html`, `assets/`) gains `admin/index.html` and `staticwebapp.config.json`. A new `api/` folder holds Azure Functions (Node 20, TypeScript, v4 programming model, bundled with esbuild exactly like Niarki's `api/`). Handlers are built from factories that take their dependencies (store, rate limiter, email sender, config, clock), so tests use in-memory fakes and production wires Table Storage and Azure Communication Services.

**Tech Stack:** Azure Static Web Apps (Free) + managed Functions, `@azure/functions` ^4.16.5, `@azure/data-tables` ^13.3.2, `@azure/communication-email` ^1.1.0, `bcryptjs` ^3.0.3, TypeScript ^5.9, esbuild ^0.25, vitest ^5, Prettier (Niarki's settings minus the Tailwind plugin), Playwright (MCP) for UI verification.

**Spec:** `docs/superpowers/specs/2026-10-18-rsvp-submission-design.md` (email design reference: `docs/superpowers/specs/assets/2026-10-18-rsvp-email-directions.html`, direction A).

## Global Constraints

- No changes to the DDS platform or Niarki repos. Niarki is copied from, never edited.
- No secrets, connection strings, passcodes or admin email addresses in the repo; all come from app settings: `AZURE_COMMUNICATION_CONNECTION_STRING`, `AZURE_COMMUNICATION_SENDER_ADDRESS`, `COUPLE_EMAILS`, `RSVP_STORAGE_CONNECTION_STRING`, `SITE_URL`, `ADMIN_EMAILS`, `ADMIN_PASSCODE_HASH`, `ADMIN_SESSION_SECRET`.
- No wedding email cap of any kind. Only throttles: honeypot + per-IP submission limit + per-IP admin login limit.
- Never log connection strings, passcodes, hashes, session secrets or full guest payloads. Error bodies to clients never include internal details.
- `index.html` keeps its single-file inline shape and current formatting; only the RSVP form area, its script, and the meta URLs change. No frontend build step.
- Guest-facing copy: button "Send RSVP" above "Share RSVP"; guest subject "Your RSVP is in — see you on 12 December"; event facts exactly: Saturday 12·12·26, Sheraton Hotel · Makurdi, 7:00 AM White wedding ceremony, 2:00 PM Traditional wedding reception, colours of the day gold, burgundy, coffee brown, army green, charcoal ash; reply-to Chris and Miriam.
- Party size 1–3 when accepting, 0 when declining. Attendance API values `accepts` / `declines` (form labels "Joyfully accepts" / "Regretfully declines").
- Format every touched TypeScript file with the `api/` Prettier config; run `npm run typecheck`, `npm test` in `api/` clean before each commit.
- Commits on branch `feature/rsvp-submission`, staging explicit paths only (never `git add -A` / `.`). Commit messages end with the session attribution line.

## Review Focus

1. Guest text containing HTML/script (name, message) must render inertly in all three emails and on the admin page → tests in Task 3 (emails) and Task 7 (admin page uses `textContent` only; verified with a `<img onerror>` name).
2. A spreadsheet-formula value (`=HYPERLINK(...)`, `+1`, `@cmd`) in any field must be neutralised in the CSV → test in Task 7 (`escapeCsvCell`).
3. Email service slow or failing must not turn a saved RSVP into an error, and must not hang past the guest's timeout → tests in Task 4 (timeout) and Task 5 (failure still 200, status `failed`).
4. Missing/blank app setting (e.g. `COUPLE_EMAILS` unset) must give a logged, named configuration error and a generic 500, not a crash or a silent skip → test in Task 1 (`readConfig`) and Task 5.
5. Same email submitted twice (changed mind, double tap) must update one row, not create two, and the couple's subject must say "changed"/"updated" → tests in Task 2 (`mergeSubmission`) and Task 5.

---

## File Structure

```
.gitignore                          ignore api/node_modules, api/dist, out/
staticwebapp.config.json            routes, headers, apiRuntime node:20
index.html                          (modify) Send RSVP button, honeypot, send flow, meta URLs
admin/index.html                    admin sign-in + RSVP list + CSV (inline CSS/JS)
.github/workflows/deploy.yml        build out/ + api, deploy to SWA
api/package.json, host.json, tsconfig.json, .prettierrc, vitest.config.ts
api/src/index.ts                    imports each function module
api/src/config.ts                   readConfig(env) → AppConfig
api/src/rsvp/validation.ts          validateRsvp(body) → result
api/src/rsvp/phone.ts               toWhatsAppNumber(phone)
api/src/rsvp/model.ts               types, mergeSubmission, computeTotals, rowKeyForEmail
api/src/storage/table-rsvp-store.ts      RsvpStore over @azure/data-tables
api/src/storage/table-rate-limiter.ts    RateLimiter over @azure/data-tables
api/src/email/email-service.ts      AzureEmailService (Niarki copy + replyTo, many to, timeout)
api/src/email/escape.ts             escapeHtml, stripLineBreaks
api/src/email/layout.ts             envelopeLayout(inner) — direction A frame
api/src/email/templates.ts          renderGuestEmail, renderCoupleEmail
api/src/http/client-ip.ts           clientIpHash(request)
api/src/admin/session.ts            createSessionCookie, verifySession
api/src/admin/passcode.ts           checkPasscode
api/src/functions/rsvp.ts           createRsvpHandler + app.http("rsvp")
api/src/functions/admin.ts          createAdminLogin/Logout/ListHandler + app.http(...)
api/src/deps.ts                     productionDeps() — lazy real wiring
api/test/*.test.ts                  vitest tests
api/scripts/render-email-previews.ts writes preview HTML for visual check
api/scripts/hash-passcode.ts        prints bcrypt hash for ADMIN_PASSCODE_HASH
```

---

### Task 1: API scaffold, config and validation

**Files:**
- Create: `api/package.json`, `api/host.json`, `api/tsconfig.json`, `api/.prettierrc`, `api/vitest.config.ts`, `api/src/index.ts`, `api/src/config.ts`, `api/src/rsvp/validation.ts`, `api/src/rsvp/phone.ts`
- Modify: `.gitignore` (add `api/node_modules/`, `api/dist/`, `out/`)
- Test: `api/test/config.test.ts`, `api/test/validation.test.ts`, `api/test/phone.test.ts`

**Interfaces:**
- Produces:
  - `type Attendance = "accepts" | "declines"`
  - `type RsvpInput = { name: string; email: string; phone: string; attendance: Attendance; partySize: number; message: string }` (in `rsvp/validation.ts`, re-exported by `rsvp/model.ts`)
  - `validateRsvp(body: unknown): { ok: true; value: RsvpInput; honeypot: boolean } | { ok: false; fieldErrors: Record<string, string> }`
  - `toWhatsAppNumber(phone: string): string | null`
  - `type AppConfig = { storageConnectionString: string; coupleEmails: string[]; siteUrl: string; adminEmails: string[]; adminPasscodeHash: string; sessionSecret: string }`
  - `readConfig(env: Record<string, string | undefined>): AppConfig` — throws `ConfigError` (message lists missing setting **names** only). Email settings are read by the email service, not here.
  - `class ConfigError extends Error`

- [ ] **Step 1: Scaffold.** `package.json` mirrors Niarki's `api/package.json` (name `chris-miriam-wedding-api`, same `build`/`typecheck` scripts) plus `"test": "vitest run"`, `"format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\" \"scripts/**/*.ts\""`, `"format:check"` (same with `--check`); dependencies above; devDeps `vitest`, `prettier`, `tsx`. `host.json` and `tsconfig.json` copy Niarki's (drop `baseUrl`/`paths`; include `src`, `test`, `scripts`). `.prettierrc` = Niarki's without `plugins`/`tailwind*`. `src/index.ts` imports `./functions/rsvp` and `./functions/admin` (add the imports in Tasks 5/6). Run `npm install` in `api/`.

- [ ] **Step 2: Write failing tests**

```ts
// validation.test.ts
const good = { name: "  Adaeze Okafor ", email: "Adaeze@Example.com", phone: "0803 555 0142",
  attendance: "accepts", partySize: 2, message: "", website: "" }
test("accepts and normalises a valid RSVP", () => {
  const r = validateRsvp(good)
  expect(r).toEqual({ ok: true, honeypot: false, value: { name: "Adaeze Okafor",
    email: "adaeze@example.com", phone: "0803 555 0142", attendance: "accepts", partySize: 2, message: "" } })
})
test("forces party size 0 when declining", () => {
  expect(validateRsvp({ ...good, attendance: "declines", partySize: 3 })).toMatchObject({ ok: true, value: { partySize: 0 } })
})
test.each([
  ["name", { name: "" }], ["name", { name: "x".repeat(101) }],
  ["email", { email: "not-an-email" }], ["email", { email: `${"a".repeat(250)}@x.io` }],
  ["phone", { phone: "12345" }], ["phone", { phone: "0803-555-0142; drop" }], ["phone", { phone: "1".repeat(26) }],
  ["attendance", { attendance: "maybe" }],
  ["partySize", { partySize: 0 }], ["partySize", { partySize: 4 }], ["partySize", { partySize: 1.5 }],
  ["message", { message: "x".repeat(1001) }],
])("rejects bad %s", (field, patch) => {
  const r = validateRsvp({ ...good, ...patch })
  expect(r.ok).toBe(false)
  expect(r.ok === false && r.fieldErrors[field]).toBeTruthy()
})
test("rejects non-object bodies", () => { expect(validateRsvp(null).ok).toBe(false); expect(validateRsvp("x").ok).toBe(false) })
test("flags filled honeypot", () => { expect(validateRsvp({ ...good, website: "spam" })).toMatchObject({ ok: true, honeypot: true }) })

// phone.test.ts
test.each([
  ["0803 555 0142", "2348035550142"], ["+234 803 555 0142", "2348035550142"],
  ["(+44) 7700 900123", "447700900123"], ["2348035550142", "2348035550142"],
  ["12345", null], ["0803", null],
])("toWhatsAppNumber(%s)", (input, expected) => expect(toWhatsAppNumber(input)).toBe(expected))

// config.test.ts
const env = { RSVP_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true", COUPLE_EMAILS: "a@x.com, B@x.com",
  SITE_URL: "https://site.example/", ADMIN_EMAILS: "A@x.com,c@x.com", ADMIN_PASSCODE_HASH: "$2b$10$h", ADMIN_SESSION_SECRET: "s".repeat(32) }
test("parses lists, lowercases emails, trims trailing slash", () => {
  expect(readConfig(env)).toMatchObject({ coupleEmails: ["a@x.com", "b@x.com"], adminEmails: ["a@x.com", "c@x.com"], siteUrl: "https://site.example" })
})
test("names every missing or blank setting without values", () => {
  expect(() => readConfig({ ...env, COUPLE_EMAILS: " ", ADMIN_SESSION_SECRET: undefined }))
    .toThrow(/COUPLE_EMAILS.*ADMIN_SESSION_SECRET|ADMIN_SESSION_SECRET.*COUPLE_EMAILS/)
})
test("rejects a short session secret", () => { expect(() => readConfig({ ...env, ADMIN_SESSION_SECRET: "short" })).toThrow(ConfigError) })
```

- [ ] **Step 3: Run tests — expect FAIL** (`cd api && npm test`: modules not found).

- [ ] **Step 4: Implement** `validation.ts`, `phone.ts`, `config.ts`.
  - Validation rules (spec): name trimmed 1–100; email trimmed, lowercased, ≤254, `^[^\s@]+@[^\s@]+\.[^\s@]+$`; phone trimmed 7–25 chars, only `[0-9 +()-]`, ≥7 digits; attendance exactly `accepts`/`declines`; partySize integer 1–3 when accepting, ignored and set 0 when declining; message optional string trimmed ≤1000; honeypot field `website` non-empty → `honeypot: true`.
  - `toWhatsAppNumber`: digits only; leading `0` + 11 digits total → `234` + rest; otherwise accept 10–15 digits as already international; else `null`.
  - `readConfig`: session secret must be ≥32 chars.

- [ ] **Step 5: Run tests — expect PASS**; `npm run typecheck`; `npm run format`.

- [ ] **Step 6: Commit**

```bash
git add .gitignore docs/superpowers/specs docs/superpowers/plans api/package.json api/package-lock.json api/host.json api/tsconfig.json api/.prettierrc api/vitest.config.ts api/src api/test
git commit -m "Add RSVP API scaffold, config and validation"
```

---

### Task 2: RSVP model and Table Storage adapters

**Files:**
- Create: `api/src/rsvp/model.ts`, `api/src/storage/table-rsvp-store.ts`, `api/src/storage/table-rate-limiter.ts`
- Test: `api/test/model.test.ts`

**Interfaces:**
- Consumes: `RsvpInput`, `Attendance` (Task 1)
- Produces:
  - `type EmailStatus = "pending" | "sent" | "failed"`
  - `type RsvpRecord = RsvpInput & { rowKey: string; firstSubmittedAt: string; lastUpdatedAt: string; submissionCount: number; previousAttendance: Attendance | null; previousPartySize: number | null; guestEmailStatus: EmailStatus; coupleEmailStatus: EmailStatus }`
  - `type SubmissionChange = "new" | "changed" | "unchanged"`
  - `rowKeyForEmail(email: string): string` — SHA-256 hex of the lowercased, trimmed email
  - `mergeSubmission(existing: RsvpRecord | null, input: RsvpInput, now: Date): { record: RsvpRecord; change: SubmissionChange }`
  - `computeTotals(records: RsvpRecord[]): { accepted: number; guests: number; declined: number }`
  - `interface RsvpStore { get(rowKey: string): Promise<RsvpRecord | null>; put(record: RsvpRecord): Promise<void>; setEmailStatus(rowKey: string, status: { guestEmailStatus: EmailStatus; coupleEmailStatus: EmailStatus }): Promise<void>; list(): Promise<RsvpRecord[]> }`
  - `interface RateLimiter { isLimited(bucket: string, windowSeconds: number, limit: number, now: Date): Promise<boolean> }` — counts this hit, returns true when the count now exceeds `limit`
  - `createTableRsvpStore(connectionString: string): RsvpStore` (table `rsvps`, PartitionKey `rsvp`, created on first use)
  - `createTableRateLimiter(connectionString: string): RateLimiter` (table `ratelimits`, PartitionKey = bucket, RowKey = window start epoch)

- [ ] **Step 1: Write failing tests**

```ts
const input = { name: "Adaeze Okafor", email: "adaeze@example.com", phone: "0803 555 0142", attendance: "accepts" as const, partySize: 2, message: "" }
const t0 = new Date("2026-11-01T10:00:00Z"), t1 = new Date("2026-11-02T10:00:00Z")
test("new submission", () => {
  const { record, change } = mergeSubmission(null, input, t0)
  expect(change).toBe("new")
  expect(record).toMatchObject({ rowKey: rowKeyForEmail("ADAEZE@example.com "), submissionCount: 1, firstSubmittedAt: t0.toISOString(),
    lastUpdatedAt: t0.toISOString(), previousAttendance: null, previousPartySize: null, guestEmailStatus: "pending", coupleEmailStatus: "pending" })
})
test("changed answer keeps first time and previous answer", () => {
  const first = mergeSubmission(null, input, t0).record
  const { record, change } = mergeSubmission(first, { ...input, attendance: "declines", partySize: 0 }, t1)
  expect(change).toBe("changed")
  expect(record).toMatchObject({ submissionCount: 2, firstSubmittedAt: t0.toISOString(), lastUpdatedAt: t1.toISOString(),
    previousAttendance: "accepts", previousPartySize: 2, attendance: "declines", partySize: 0 })
})
test("same answer is unchanged", () => {
  const first = mergeSubmission(null, input, t0).record
  expect(mergeSubmission(first, { ...input, message: "See you!" }, t1).change).toBe("unchanged")
})
test("totals", () => {
  const a = mergeSubmission(null, input, t0).record
  const b = mergeSubmission(null, { ...input, email: "b@x.com", partySize: 3 }, t0).record
  const c = mergeSubmission(null, { ...input, email: "c@x.com", attendance: "declines", partySize: 0 }, t0).record
  expect(computeTotals([a, b, c])).toEqual({ accepted: 2, guests: 5, declined: 1 })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `model.ts`. Then the two adapters with `TableClient.fromConnectionString`:
  - Store: `put` = `upsertEntity(entity, "Replace")`; `setEmailStatus` = `updateEntity(..., "Merge")`; `list` pages through `listEntities` for PartitionKey `rsvp`; `get` returns `null` on 404 (any other error rethrows). Create the table once per process (`createTable`, ignore 409 only).
  - Rate limiter: fixed window `floor(epoch / window) * window`; read entity → `updateEntity` with its ETag (`"Merge"`, `{ etag }`), or `createEntity` with count 1 on 404; on 412/409 retry, max 3 attempts, then treat as limited (fail closed). No other error is swallowed.
  - The adapters are verified live in Task 10 (no Azurite here).

- [ ] **Step 4: Run tests — expect PASS**; typecheck; format.

- [ ] **Step 5: Commit** (`git add api/src/rsvp/model.ts api/src/storage api/test/model.test.ts`; message "Add RSVP model and Table Storage adapters").

---

### Task 3: Email templates (direction A)

**Files:**
- Create: `api/src/email/escape.ts`, `api/src/email/layout.ts`, `api/src/email/templates.ts`, `api/scripts/render-email-previews.ts`
- Test: `api/test/templates.test.ts`

**Interfaces:**
- Consumes: `RsvpRecord`, `SubmissionChange`, `computeTotals` return type (Task 2), `toWhatsAppNumber` (Task 1)
- Produces:
  - `type RenderedEmail = { subject: string; html: string; text: string }`
  - `escapeHtml(value: string): string`, `stripLineBreaks(value: string): string`
  - `renderGuestEmail(record: RsvpRecord, siteUrl: string): RenderedEmail` (accept or decline variant by `record.attendance`)
  - `renderCoupleEmail(args: { record: RsvpRecord; change: SubmissionChange; totals: { accepted: number; guests: number; declined: number }; siteUrl: string }): RenderedEmail`

- [ ] **Step 1: Write failing tests**

```ts
const base = mergeSubmission(null, { name: "Adaeze Okafor", email: "adaeze@example.com", phone: "0803 555 0142",
  attendance: "accepts", partySize: 2, message: "Can't wait!" }, new Date("2026-11-01T10:00:00Z")).record
const totals = { accepted: 32, guests: 64, declined: 5 }
const site = "https://site.example"
test("guest accepting", () => {
  const e = renderGuestEmail(base, site)
  expect(e.subject).toBe("Your RSVP is in — see you on 12 December")
  for (const s of ["Thank you, Adaeze", "Joyfully accepts, party of 2", "SHERATON HOTEL", "7:00 AM", "2:00 PM", "COLOURS OF THE DAY", "YOUR PRESENCE IS OUR GREATEST GIFT", `href="${site}/"`]) expect(e.html).toContain(s)
  expect(e.text).toContain("Saturday, 12 December 2026")
})
test("guest declining has no schedule", () => {
  const e = renderGuestEmail({ ...base, attendance: "declines", partySize: 0 }, site)
  expect(e.subject).toBe("We'll miss you — Chris & Miriam")
  expect(e.html).not.toContain("7:00 AM")
})
test.each([
  ["new", {}, "Adaeze Okafor joyfully accepts (party of 2)"],
  ["new", { attendance: "declines", partySize: 0 }, "Adaeze Okafor regretfully declines"],
  ["changed", { attendance: "declines", partySize: 0, previousAttendance: "accepts", previousPartySize: 2 }, "Adaeze Okafor changed their RSVP: now regretfully declines (was party of 2)"],
  ["changed", { partySize: 3, previousAttendance: "accepts", previousPartySize: 2 }, "Adaeze Okafor changed their RSVP: now joyfully accepts (party of 3, was party of 2)"],
  ["changed", { previousAttendance: "declines", previousPartySize: 0 }, "Adaeze Okafor changed their RSVP: now joyfully accepts (party of 2, was declining)"],
  ["unchanged", {}, "Adaeze Okafor updated their RSVP"],
])("couple subject %s", (change, patch, subject) => {
  expect(renderCoupleEmail({ record: { ...base, ...patch } as RsvpRecord, change: change as SubmissionChange, totals, siteUrl: site }).subject).toBe(subject)
})
test("couple email links and totals", () => {
  const e = renderCoupleEmail({ record: base, change: "new", totals, siteUrl: site })
  expect(e.html).toContain("https://wa.me/2348035550142")
  expect(e.html).toContain(`${site}/admin/`)
  expect(e.html).toContain("32 accepted")
  expect(e.html).toContain("64 guests")
})
test("no WhatsApp button when the number can't be converted", () => {
  expect(renderCoupleEmail({ record: { ...base, phone: "12 34 56 7" }, change: "new", totals, siteUrl: site }).html).not.toContain("wa.me")
})
test("hostile guest text is inert everywhere", () => {
  const evil = { ...base, name: '<img src=x onerror=alert(1)>\r\nBcc: x@y.z', message: "<script>alert(1)</script>" }
  for (const e of [renderGuestEmail(evil, site), renderCoupleEmail({ record: evil, change: "new", totals, siteUrl: site })]) {
    expect(e.html).not.toMatch(/<img src=x|<script>/)
    expect(e.subject).not.toMatch(/[\r\n]/)
  }
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** `layout.ts` reproduces direction A's frame from the spec asset (outer `#140504`, card `#3d0b0c` with gold double border, max-width 520px, 22px side padding, Didot→Georgia stack, stacked full-width buttons), as one `envelopeLayout(inner: string): string`. `templates.ts` fills it: guest accept = asset's guest email (first name = first word of name); guest decline = same frame with "Thank you, {first}", "We're sorry you can't make it, and we'll miss you. Thank you for letting us know.", the C|M monogram, "YOUR PRESENCE IS OUR GREATEST GIFT" removed, reply/resubmit footer; couple = asset's couple email, headline "{Name} is coming" / "{Name} can't make it", previous answer line when `change === "changed"`, totals line, buttons "WhatsApp {first}" (only when `toWhatsAppNumber` is non-null) and "See all RSVPs" → `${siteUrl}/admin/`, `mailto:`/`tel:` links. Text versions carry the same facts as plain lines. Every guest value goes through `escapeHtml` (HTML) or `stripLineBreaks` (subjects).

- [ ] **Step 4: Run tests — expect PASS.** Then `npx tsx scripts/render-email-previews.ts` writes `api/dist/previews/{guest-accepts,guest-declines,couple-new,couple-changed}.html`; open each in Playwright at 390×844 and full-page screenshot; confirm no horizontal scroll and it matches the asset's direction A.

- [ ] **Step 5: Commit** ("Add direction A RSVP email templates").

---

### Task 4: Email service

**Files:**
- Create: `api/src/email/email-service.ts`
- Test: `api/test/email-service.test.ts`

**Interfaces:**
- Produces:
  - `type OutgoingEmail = { to: string[]; replyTo: string[]; subject: string; html: string; text: string }`
  - `interface EmailSender { send(email: OutgoingEmail): Promise<void> }` — resolves when sent, rejects on failure or timeout
  - `createAzureEmailSender(options: { connectionString: string | undefined; senderAddress: string | undefined; timeoutMs: number; clientFactory?: (cs: string) => Pick<EmailClient, "beginSend"> }): EmailSender`
  - Production timeout `EMAIL_TIMEOUT_MS = 10_000`.

- [ ] **Step 1: Write failing tests** (fake `clientFactory`):
  - `"sends to all recipients with reply-to"`: fake records the `EmailMessage`; assert `recipients.to` = `[{address:"a@x.com"},{address:"b@x.com"}]`, `replyTo` = `[{address:"c@x.com"}]`, `senderAddress`, `content.subject/html/plainText`.
  - `"rejects when not configured"`: `connectionString: undefined` → `send` rejects with `/not configured/`.
  - `"rejects after the timeout"`: fake poller never resolves, `timeoutMs: 20` → rejects with `/timed out/` within 200 ms.
  - `"error never contains the connection string"`: factory throws `new Error("bad endpoint=https://x;accesskey=SECRET")` → rejection message does not contain `SECRET`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** following Niarki's `AzureEmailService` (lazy client, never log/echo the connection string), returning rejections instead of silently returning; `Promise.race` the poller's `pollUntilDone()` against a timer and clear the timer in `finally`.

- [ ] **Step 4: Run — expect PASS**; typecheck; format.

- [ ] **Step 5: Commit** ("Add Azure email sender with reply-to and timeout").

---

### Task 5: `POST /api/rsvp`

**Files:**
- Create: `api/src/http/client-ip.ts`, `api/src/functions/rsvp.ts`, `api/src/deps.ts`
- Modify: `api/src/index.ts` (import `./functions/rsvp`)
- Test: `api/test/rsvp-handler.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `clientIpHash(request: HttpRequest): string` — first of `x-azure-clientip`, first entry of `x-forwarded-for`, else `"unknown"`; port stripped; SHA-256 hex
  - `type RsvpDeps = { store: RsvpStore; limiter: RateLimiter; email: EmailSender; config: () => AppConfig; now: () => Date; log: { error(msg: string, err?: unknown): void } }`
  - `createRsvpHandler(deps: RsvpDeps): (request: HttpRequest) => Promise<HttpResponseInit>`
  - `productionDeps(): RsvpDeps & AdminDeps` in `deps.ts` (built lazily on first call; `AdminDeps` defined in Task 6 — add its fields there)
  - Submission limit: bucket `rsvp:${ipHash}`, window 3600 s, limit 10.

- [ ] **Step 1: Write failing tests** with in-memory fakes (a `Map` store, a counting limiter, a recording email sender) and `new HttpRequest({ method: "POST", url: "http://localhost/api/rsvp", body: { string: JSON.stringify(body) }, headers: { "x-forwarded-for": "1.2.3.4:5678" } })`:
  - `"saves and emails guest and couple"`: 200 `{ ok: true }`; one stored row; two sends — guest `to=[guest]`, `replyTo=coupleEmails`; couple `to=coupleEmails`, `replyTo=[guest]`; row statuses `sent`/`sent`.
  - `"400 with field errors"`: bad email → 400, `jsonBody.fieldErrors.email` set, nothing stored or sent.
  - `"400 on invalid JSON"`.
  - `"honeypot pretends success"`: `website: "x"` → 200, nothing stored or sent.
  - `"429 when rate limited"`: limiter returns true → 429, nothing stored.
  - `"500 when save fails, nothing sent"`: store `put` rejects → 500 body without the error text; zero sends; `log.error` called.
  - `"email failure still succeeds"`: sender rejects for the couple email → 200; statuses `sent`/`failed`; `log.error` called.
  - `"config error is a logged 500"`: `config` throws `ConfigError` → 500, `log.error` message names the setting.
  - `"resubmission updates the same row and marks change"`: submit accept 2, then decline → one row, `submissionCount` 2, couple subject starts with `"Adaeze Okafor changed their RSVP"`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** the handler in this order: parse JSON → `validateRsvp` → honeypot short-circuit → `config()` → `limiter.isLimited` → `store.get` + `mergeSubmission` + `store.put` → `store.list` + `computeTotals` → `Promise.allSettled` both sends → `store.setEmailStatus` (its failure is logged, not surfaced) → 200. Register with `app.http("rsvp", { methods: ["POST"], authLevel: "anonymous", route: "rsvp", handler })`, wrapping `createRsvpHandler(productionDeps())` lazily so a bad setting cannot stop registration (Niarki's lesson). Error JSON shape: `{ error: string, message: string, fieldErrors?: Record<string,string> }`.

- [ ] **Step 4: Run — expect PASS**; typecheck; format; `npm run build` succeeds.

- [ ] **Step 5: Commit** ("Add RSVP submission function").

---

### Task 6: Admin sign-in and RSVP list API

**Files:**
- Create: `api/src/admin/session.ts`, `api/src/admin/passcode.ts`, `api/src/functions/admin.ts`, `api/scripts/hash-passcode.ts`
- Modify: `api/src/deps.ts`, `api/src/index.ts` (import `./functions/admin`)
- Test: `api/test/admin.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `RsvpStore`, `RateLimiter`, `computeTotals`, `clientIpHash`.
- Produces:
  - Cookie name `cm_admin`; lifetime 7 days.
  - `createSessionCookie(email: string, secret: string, now: Date): string` — value `base64url(JSON {e, exp}).base64url(HMAC-SHA256)`
  - `verifySession(cookieValue: string | undefined, secret: string, allowedEmails: string[], now: Date): string | null` — returns the email or `null`; constant-time signature compare
  - `checkPasscode(passcode: string, hash: string): Promise<boolean>` (bcryptjs `compare`)
  - `type AdminDeps = { store: RsvpStore; limiter: RateLimiter; config: () => AppConfig; now: () => Date; log: {...} }`
  - `createAdminLoginHandler`, `createAdminLogoutHandler`, `createRsvpListHandler` (each `(deps: AdminDeps) => (req) => Promise<HttpResponseInit>`)
  - Routes: `POST /api/auth/login` body `{ email, passcode }`; `POST /api/auth/logout`; `GET /api/rsvps` → `{ rsvps: RsvpRecord[] (newest lastUpdatedAt first, without rowKey), totals }`
  - Login limit: bucket `login:${ipHash}`, window 900 s, limit 10 attempts.
  - `scripts/hash-passcode.ts`: reads the passcode from stdin (not argv, so it stays out of shell history), prints the bcrypt hash (cost 12).

- [ ] **Step 1: Write failing tests:**
  - session: round-trip returns email; tampered payload → `null`; expired (`now` + 8 days) → `null`; email no longer allowlisted → `null`; wrong secret → `null`; malformed strings (`""`, `"a.b.c"`, `"%%"`) → `null`.
  - login: allowlisted email (any case) + right passcode → 200, `cookies[0]` has `name: "cm_admin"`, `httpOnly: true`, `secure: true`, `sameSite: "Strict"`, `path: "/"`, `maxAge: 604800`; wrong passcode → 401 `{ message: "That email and passcode don't match." }`; unlisted email + right passcode → same 401 body; limiter true → 429 before checking the passcode.
  - logout: 200 with `cm_admin` cookie `maxAge: 0`.
  - list: no cookie → 401; valid cookie → 200 sorted newest first with totals and no `rowKey`; store failure → 500 logged.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**, reading the cookie from `request.headers.get("cookie")`. Register the three `app.http` routes (`authLevel: "anonymous"`; auth is the cookie).

- [ ] **Step 4: Run — expect PASS**; typecheck; format; build.

- [ ] **Step 5: Commit** ("Add passcode admin sign-in and RSVP list API").

---

### Task 7: Admin page and Static Web App config

**Files:**
- Create: `admin/index.html`, `staticwebapp.config.json`

**Interfaces:**
- Consumes: Task 6 routes and JSON shapes.
- Produces: `escapeCsvCell(value: string): string` inside the page script — prefixes `'` when the value starts with `=`, `+`, `-`, `@`, tab or CR, then CSV-quotes it.

- [ ] **Step 1: Build `admin/index.html`** (single file, inline CSS/JS, invitation palette `--night #080201`, `--oxblood #3d0b0c`, `--gold #d9a84c`, `--gold-bright #f0ce83`, `--ivory #f5e9d6`, `--muted #c5a77d`, Didot stack; mobile first, 16px gutters):
  - Sign-in view: email + passcode fields, "Sign in" button, error line.
  - List view: totals ("32 accepted · 64 guests · 5 declined" style line), newest-first cards (name, response + party size, "changed" note when `previousAttendance` set, phone with `tel:` and WhatsApp links, email `mailto:`, message, last updated, email statuses shown only when `failed`), "Download CSV" and "Sign out" buttons.
  - On load: `GET /api/rsvps`; 401 → sign-in view. All data rendered with `textContent`/`setAttribute` only; never `innerHTML` with data.
  - CSV columns: Name, Email, Phone, Response, Party size, Message, First submitted, Last updated, Times submitted, Guest email, Couple email; built with `escapeCsvCell`; downloaded as `chris-miriam-rsvps.csv`.
- [ ] **Step 2: Write `staticwebapp.config.json`:** `platform.apiRuntime "node:20"`; `globalHeaders` `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`; route `/admin/*` with header `Cache-Control: no-store` and `X-Robots-Tag: noindex`; `navigationFallback` not used.
- [ ] **Step 3: Verify in Playwright at 390×844** against `python3 -m http.server` on `out/`-equivalent root, mocking `/api/**` with `page.route`: 401 → sign-in shows; login success → list renders; a row named `<img src=x onerror=alert(1)>` renders as text and no dialog fires; CSV download contains `'=HYPERLINK("x")` for a message of `=HYPERLINK("x")`; screenshot both views.
- [ ] **Step 4: Commit** ("Add RSVP admin page and Static Web App config").

---

### Task 8: Invitation form: Send RSVP

**Files:**
- Modify: `index.html` (RSVP CSS block ~572–592, form ~695–744, script ~1114–1157)

**Interfaces:**
- Consumes: `POST /api/rsvp` body `{ name, email, phone, attendance: "accepts"|"declines", partySize, message, website }`; responses 200 / 400 `fieldErrors` / 429 / 5xx.

- [ ] **Step 1: Markup.** Inside the form, above the existing button: a visually hidden honeypot `<label class="hp">Website<input name="website" tabindex="-1" autocomplete="off"></label>` (`.hp` off-screen, `aria-hidden="true"`); new `<button class="submit-rsvp" type="submit" id="sendRsvp">Send RSVP</button>`; change the existing button to `type="button" id="shareRsvp" class="share-rsvp"` (keeps label "Share RSVP"). Add `.share-rsvp` CSS: same size/shape as `.submit-rsvp` but transparent background, gold border, gold text, no shadow; `.submit-rsvp[disabled]` dimmed.
- [ ] **Step 2: Script.** `rsvpForm` `submit` → new `sendRsvp(event)`: `preventDefault`, `validatePhone`, `reportValidity`, map attendance label → API value, POST JSON with `AbortController` timeout 20 s, button disabled + text "Sending…" until settled, double submits ignored while in flight. Status text (`shareStatus`):
  - 200: "RSVP sent. A confirmation is on its way to your email."
  - 400: first field error message, and focus that field.
  - 429: "Too many tries from this connection. Please wait a few minutes and try again."
  - network/timeout/5xx: "Your RSVP didn't go through. Please try again, or tap Share RSVP to send it to Chris or Miriam directly."
  - `#shareRsvp` click → existing `shareRsvp` (adjusted to run the same validity checks; no `event.preventDefault` dependency on form submit).
- [ ] **Step 3: Verify in Playwright at 390×844** via `python3 -m http.server`, mocking `/api/rsvp` with `page.route` for 200, 400 (`fieldErrors.email`), 429, 500 and an aborted request: open invitation → RSVP → fill → Send RSVP; assert each status text, button re-enabled, honeypot not visible or focusable (Tab order skips it), Share RSVP still works. Screenshot success state.
- [ ] **Step 4: Commit** ("Add Send RSVP submission to invitation form").

---

### Task 9: Deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1:** Workflow modelled on Niarki's `deploy-static-web-app.yml`: triggers push to `main`, PRs to `main`, `workflow_dispatch`; Node 20; assemble `out/` with `index.html`, `.nojekyll` excluded, `assets/`, `admin/`, `staticwebapp.config.json`; in `api/`: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm prune --omit=dev`; deploy step (skipped on PRs) with `Azure/static-web-apps-deploy@v1`, `azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}`, `action: upload`, `app_location: out`, `api_location: api`, `skip_app_build: true`, `skip_api_build: true`. `docs/` is never uploaded.
- [ ] **Step 2:** Validate YAML locally (`python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml'))"`), and run the same assemble + api commands locally to prove they pass.
- [ ] **Step 3: Commit** ("Add Static Web App deploy workflow").

---

### Task 10: Live setup and end-to-end check (owner + Claude, computer use)

Done together; the owner performs sign-ins and approves each Azure/GitHub action.

- [ ] **Step 1: Azure (DDS prod subscription).** Create resource group `rg-chris-miriam-wedding` (tag `project=chris-miriam-wedding`); storage account (Standard LRS, same region, minimum TLS 1.2, no public blob access); Static Web App `swa-chris-miriam-wedding` (Free, deployment source "Other").
- [ ] **Step 2: App settings** on the Static Web App: the eight settings from Global Constraints. ACS connection string and sender address copied from the existing DDS prod ACS / Niarki configuration; `COUPLE_EMAILS` = Chris's and Miriam's Gmail; `ADMIN_EMAILS` = Chris's, Miriam's and the owner's; `ADMIN_PASSCODE_HASH` from `npx tsx scripts/hash-passcode.ts` (owner types the passcode); `ADMIN_SESSION_SECRET` from `openssl rand -base64 48`; `SITE_URL` = the SWA default hostname.
- [ ] **Step 3: Meta URLs.** Replace `https://chrisdelzark.github.io/chris-miriam-wedding/` in `index.html` `og:url`, `og:image`, `og:image:secure_url`, `canonical` with the SWA URL; commit ("Point invitation meta tags at the Static Web App").
- [ ] **Step 4: GitHub (Chris if admin needed).** Add repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN` (SWA deployment token); push branch, open PR, confirm the workflow's validation passes; merge to `main`; confirm the deploy job succeeds.
- [ ] **Step 5: End-to-end on the live site (Playwright, 390×844):** submit a real RSVP with the owner's address; confirm both emails arrive (guest + couple) and render as direction A on a phone; submit again with a changed answer and confirm the "changed their RSVP" subject; sign in to `/admin/` with the owner's email + passcode, see the row and totals, download CSV; wrong passcode shows the error. Then delete the test rows from the `rsvps` table.
- [ ] **Step 6: Switch off GitHub Pages** (repo Settings → Pages) once the live check passes; confirm the old URL no longer serves the form.
- [ ] **Step 7: Definition of done.** `api/`: `npm run format:check`, `npm run typecheck`, `npm test` clean; review the whole diff for security/reliability (secrets, escaping, error handling, rate limits, cookie flags); fix confirmed defects; report results and leave the Playwright page open for the owner.
