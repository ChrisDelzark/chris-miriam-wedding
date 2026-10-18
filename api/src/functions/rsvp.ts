import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions"
import { ConfigError, type AppConfig } from "../config"
import type { EmailSender } from "../email/email-service"
import { renderCoupleEmail, renderGuestEmail } from "../email/templates"
import { productionDeps } from "../deps"
import { clientIpHash } from "../http/client-ip"
import {
  computeTotals,
  mergeSubmission,
  rowKeyForEmail,
  type EmailStatus,
  type RateLimiter,
  type RsvpStore,
} from "../rsvp/model"
import { validateRsvp } from "../rsvp/validation"

export type RsvpDeps = {
  store: RsvpStore
  limiter: RateLimiter
  email: EmailSender
  config: () => AppConfig
  now: () => Date
  log: { error(message: string, err?: unknown): void }
}

const RATE_WINDOW_SECONDS = 600
const RATE_LIMIT = 10

function errorResponse(
  status: number,
  error: string,
  message: string,
  fieldErrors?: Record<string, string>
): HttpResponseInit {
  return {
    status,
    jsonBody: { error, message, ...(fieldErrors && { fieldErrors }) },
  }
}

const serverError = () =>
  errorResponse(
    500,
    "Unable to process request",
    "Something went wrong while saving your RSVP. Please try again."
  )

function status(result: PromiseSettledResult<void>): EmailStatus {
  return result.status === "fulfilled" ? "sent" : "failed"
}

export function createRsvpHandler(deps: RsvpDeps) {
  return async function rsvpHandler(
    request: HttpRequest
  ): Promise<HttpResponseInit> {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return errorResponse(400, "Invalid input", "Request body must be JSON.")
    }

    const validation = validateRsvp(body)
    if (!validation.ok) {
      return errorResponse(
        400,
        "Invalid input",
        "Please review the highlighted fields.",
        validation.fieldErrors
      )
    }
    if (validation.honeypot) return { status: 200, jsonBody: { ok: true } }

    try {
      const config = deps.config()
      const bucket = `rsvp:${clientIpHash(request)}`
      if (
        await deps.limiter.isLimited(
          bucket,
          RATE_WINDOW_SECONDS,
          RATE_LIMIT,
          deps.now()
        )
      ) {
        return errorResponse(
          429,
          "Too many requests",
          "Too many RSVPs from this connection. Please try again shortly."
        )
      }

      const input = validation.value
      const rowKey = rowKeyForEmail(input.email)
      const { record, change } = mergeSubmission(
        await deps.store.get(rowKey),
        input,
        deps.now()
      )
      await deps.store.put(record)

      const totals = computeTotals(await deps.store.list())
      const guestMail = renderGuestEmail(record, config.siteUrl)
      const coupleMail = renderCoupleEmail({
        record,
        change,
        totals,
        siteUrl: config.siteUrl,
      })
      // Timeouts are not retried: a timed-out send may still deliver late.
      const [guest, couple] = await Promise.allSettled([
        deps.email.send({
          to: [record.email],
          replyTo: config.coupleEmails,
          ...guestMail,
        }),
        deps.email.send({
          to: config.coupleEmails,
          replyTo: [record.email],
          ...coupleMail,
        }),
      ])
      if (guest.status === "rejected") {
        deps.log.error("Guest RSVP email failed", guest.reason)
      }
      if (couple.status === "rejected") {
        deps.log.error("Couple RSVP email failed", couple.reason)
      }

      try {
        await deps.store.setEmailStatus(rowKey, {
          guestEmailStatus: status(guest),
          coupleEmailStatus: status(couple),
        })
      } catch (error) {
        deps.log.error("Saving RSVP email status failed", error)
      }
      return { status: 200, jsonBody: { ok: true } }
    } catch (error) {
      if (error instanceof ConfigError) {
        deps.log.error(`RSVP configuration error: ${error.message}`)
      } else {
        deps.log.error("RSVP submission failed", error)
      }
      return serverError()
    }
  }
}

app.http("rsvp", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "rsvp",
  handler: (request) => createRsvpHandler(productionDeps())(request),
})
