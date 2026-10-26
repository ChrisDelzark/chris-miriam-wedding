import { beforeEach, describe, expect, it, vi } from "vitest"
import { createTableRateLimiter } from "../src/storage/table-rate-limiter"
import { createTableRsvpStore } from "../src/storage/table-rsvp-store"
import type { RsvpRecord } from "../src/rsvp/model"

const tables = vi.hoisted(() => {
  const calls: Array<{ method: string; options: unknown }> = []
  const clientOptions: unknown[] = []
  const record = (method: string, options: unknown) =>
    calls.push({ method, options })
  const notFound = Object.assign(new Error("not found"), { statusCode: 404 })

  class FakeTableClient {
    static fromConnectionString(_cs: string, _table: string, options: unknown) {
      clientOptions.push(options)
      return new FakeTableClient()
    }
    async createTable(options?: unknown) {
      record("createTable", options)
    }
    async getEntity(_pk: string, _rk: string, options?: unknown) {
      record("getEntity", options)
      throw notFound
    }
    async upsertEntity(_entity: unknown, _mode?: string, options?: unknown) {
      record("upsertEntity", options)
    }
    async updateEntity(_entity: unknown, _mode?: string, options?: unknown) {
      record("updateEntity", options)
    }
    async createEntity(_entity: unknown, options?: unknown) {
      record("createEntity", options)
    }
    async *listEntities(options?: unknown) {
      record("listEntities", options)
    }
  }

  return { calls, clientOptions, FakeTableClient }
})

vi.mock("@azure/data-tables", () => ({ TableClient: tables.FakeTableClient }))

beforeEach(() => {
  tables.calls.length = 0
  tables.clientOptions.length = 0
})

describe("table storage", () => {
  it("bounds retries and gives every operation an abort signal", async () => {
    const store = createTableRsvpStore("UseDevelopmentStorage=true")
    const limiter = createTableRateLimiter("UseDevelopmentStorage=true")

    await store.get("row")
    await store.put({ rowKey: "row" } as RsvpRecord)
    await store.setEmailStatus("row", {
      guestEmailStatus: "sent",
      coupleEmailStatus: "sent",
    })
    await store.list()
    await limiter.isLimited("bucket", 3600, 10, new Date())

    expect(tables.clientOptions).toEqual([
      { retryOptions: { maxRetries: 2, maxRetryDelayInMs: 2000 } },
      { retryOptions: { maxRetries: 2, maxRetryDelayInMs: 2000 } },
    ])
    expect(new Set(tables.calls.map((call) => call.method))).toEqual(
      new Set([
        "createTable",
        "getEntity",
        "upsertEntity",
        "updateEntity",
        "createEntity",
        "listEntities",
      ])
    )
    for (const call of tables.calls) {
      expect(call.options, call.method).toMatchObject({
        abortSignal: expect.any(AbortSignal),
      })
    }
  })
})
