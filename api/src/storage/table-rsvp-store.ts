import { TableClient } from "@azure/data-tables"
import type { EmailStatus, RsvpRecord, RsvpStore } from "../rsvp/model"
import type { Attendance } from "../rsvp/validation"

const TABLE_NAME = "rsvps"
const PARTITION_KEY = "rsvp"
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

// Null fields are stored absent and read back as null.
function toEntity(record: RsvpRecord) {
  return {
    partitionKey: PARTITION_KEY,
    rowKey: record.rowKey,
    name: record.name,
    email: record.email,
    phone: record.phone,
    attendance: record.attendance,
    partySize: record.partySize,
    message: record.message,
    firstSubmittedAt: record.firstSubmittedAt,
    lastUpdatedAt: record.lastUpdatedAt,
    submissionCount: record.submissionCount,
    previousAttendance: record.previousAttendance ?? undefined,
    previousPartySize: record.previousPartySize ?? undefined,
    guestEmailStatus: record.guestEmailStatus,
    coupleEmailStatus: record.coupleEmailStatus,
  }
}

function fromEntity(entity: Record<string, unknown>): RsvpRecord {
  return {
    rowKey: entity.rowKey as string,
    name: entity.name as string,
    email: entity.email as string,
    phone: entity.phone as string,
    attendance: entity.attendance as Attendance,
    partySize: entity.partySize as number,
    message: entity.message as string,
    firstSubmittedAt: entity.firstSubmittedAt as string,
    lastUpdatedAt: entity.lastUpdatedAt as string,
    submissionCount: entity.submissionCount as number,
    previousAttendance: (entity.previousAttendance as Attendance) ?? null,
    previousPartySize: (entity.previousPartySize as number) ?? null,
    guestEmailStatus: entity.guestEmailStatus as EmailStatus,
    coupleEmailStatus: entity.coupleEmailStatus as EmailStatus,
  }
}

export function createTableRsvpStore(connectionString: string): RsvpStore {
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
    async get(rowKey) {
      await ensureTable()
      try {
        const entity = await client.getEntity(PARTITION_KEY, rowKey, timeout())
        return fromEntity(entity)
      } catch (error) {
        if (hasStatusCode(error, 404)) return null
        throw error
      }
    },

    async put(record) {
      await ensureTable()
      await client.upsertEntity(toEntity(record), "Replace", timeout())
    },

    async setEmailStatus(rowKey, status) {
      await ensureTable()
      await client.updateEntity(
        { partitionKey: PARTITION_KEY, rowKey, ...status },
        "Merge",
        timeout()
      )
    },

    async list() {
      await ensureTable()
      const records: RsvpRecord[] = []
      const entities = client.listEntities({
        queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` },
        ...timeout(),
      })
      for await (const entity of entities) {
        records.push(fromEntity(entity))
      }
      return records
    },
  }
}
