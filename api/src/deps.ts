import { createAzureEmailSender, EMAIL_TIMEOUT_MS } from "./email/email-service"
import { readConfig } from "./config"
import type { RsvpDeps } from "./functions/rsvp"
import { createTableRateLimiter } from "./storage/table-rate-limiter"
import { createTableRsvpStore } from "./storage/table-rsvp-store"

let cached: RsvpDeps | undefined

// Built on first call, not at import, so a bad setting cannot stop functions
// from registering. Config is read per request through `config()`.
export function productionDeps(): RsvpDeps {
  if (cached) return cached
  const config = () => readConfig(process.env)
  let store: RsvpDeps["store"] | undefined
  let limiter: RsvpDeps["limiter"] | undefined

  cached = {
    get store() {
      store ??= createTableRsvpStore(config().storageConnectionString)
      return store
    },
    get limiter() {
      limiter ??= createTableRateLimiter(config().storageConnectionString)
      return limiter
    },
    email: createAzureEmailSender({
      connectionString: process.env.AZURE_COMMUNICATION_CONNECTION_STRING,
      senderAddress: process.env.AZURE_COMMUNICATION_SENDER_ADDRESS,
      timeoutMs: EMAIL_TIMEOUT_MS,
    }),
    config,
    now: () => new Date(),
    // Only our own message text is logged, never error internals or payloads.
    log: {
      error: (message, err) =>
        console.error(message, err instanceof Error ? err.message : ""),
    },
  }
  return cached
}
