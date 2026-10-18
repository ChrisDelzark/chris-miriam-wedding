import { TableClient } from "@azure/data-tables"
import type { RateLimiter } from "../rsvp/model"

const TABLE_NAME = "ratelimits"
const MAX_ATTEMPTS = 3
// Bounded so a slow or unreachable table cannot hold a request open.
const CLIENT_OPTIONS = {
  retryOptions: { maxRetries: 2, maxRetryDelayInMs: 2000 },
}
const OPERATION_TIMEOUT_MS = 5000

const timeout = () => ({
  abortSignal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
})

function hasStatusCode(error: unknown, statusCode: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { statusCode?: number }).statusCode === statusCode
  )
}

export function createTableRateLimiter(connectionString: string): RateLimiter {
  const client = TableClient.fromConnectionString(
    connectionString,
    TABLE_NAME,
    CLIENT_OPTIONS
  )
  let tableReady: Promise<void> | null = null

  function ensureTable(): Promise<void> {
    tableReady ??= client.createTable(timeout()).catch((error: unknown) => {
      tableReady = null
      if (!hasStatusCode(error, 409)) throw error
      tableReady = Promise.resolve()
    })
    return tableReady
  }

  return {
    async isLimited(bucket, windowSeconds, limit, now) {
      await ensureTable()
      const epochSeconds = Math.floor(now.getTime() / 1000)
      const windowStart =
        Math.floor(epochSeconds / windowSeconds) * windowSeconds
      const rowKey = String(windowStart)

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        let existing
        try {
          existing = await client.getEntity<{ count: number }>(
            bucket,
            rowKey,
            timeout()
          )
        } catch (error) {
          if (!hasStatusCode(error, 404)) throw error
        }

        try {
          if (existing === undefined) {
            await client.createEntity(
              { partitionKey: bucket, rowKey, count: 1 },
              timeout()
            )
            return 1 > limit
          }
          const count = existing.count + 1
          await client.updateEntity(
            { partitionKey: bucket, rowKey, count },
            "Merge",
            { etag: existing.etag, ...timeout() }
          )
          return count > limit
        } catch (error) {
          // Lost a race with a concurrent hit; re-read and retry.
          if (!hasStatusCode(error, 412) && !hasStatusCode(error, 409)) {
            throw error
          }
        }
      }
      return true
    },
  }
}
