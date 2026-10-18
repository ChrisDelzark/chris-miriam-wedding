import {
  EmailClient,
  type EmailMessage,
  type EmailSendResult,
} from "@azure/communication-email"

export const EMAIL_TIMEOUT_MS = 10_000

export type OutgoingEmail = {
  to: string[]
  replyTo: string[]
  subject: string
  html: string
  text: string
}

export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>
}

type EmailClientLike = Pick<EmailClient, "beginSend">
type EmailPoller = Awaited<ReturnType<EmailClientLike["beginSend"]>>

const BUDGET_SPENT = Symbol("budget spent")
const FAILED_STATUSES = new Set(["Failed", "Canceled"])

export type AzureEmailSenderOptions = {
  connectionString: string | undefined
  senderAddress: string | undefined
  timeoutMs: number
  clientFactory?: (connectionString: string) => EmailClientLike
}

const createRealClient = (connectionString: string): EmailClientLike =>
  new EmailClient(connectionString)

// Every rejection uses a fixed message: SDK errors echo the connection string
// (including the access key), so they are never forwarded or attached as cause.
export function createAzureEmailSender(
  options: AzureEmailSenderOptions
): EmailSender {
  const { connectionString, senderAddress, timeoutMs } = options
  const clientFactory = options.clientFactory ?? createRealClient
  let client: EmailClientLike | null = null

  // Built on first send so a bad setting cannot stop functions from registering.
  // A failed creation is not cached.
  function getClient(connection: string): EmailClientLike {
    if (client) return client
    try {
      client = clientFactory(connection)
    } catch {
      throw new Error("Email client could not be created")
    }
    return client
  }

  async function accept(
    emailClient: EmailClientLike,
    message: EmailMessage
  ): Promise<EmailPoller> {
    try {
      return await emailClient.beginSend(message)
    } catch {
      throw new Error("Email send failed")
    }
  }

  async function poll(poller: EmailPoller): Promise<EmailSendResult> {
    try {
      return await poller.pollUntilDone()
    } catch {
      throw new Error("Email send failed")
    }
  }

  return {
    async send(email) {
      if (!connectionString || !senderAddress) {
        throw new Error("Email is not configured")
      }
      const emailClient = getClient(connectionString)

      const message: EmailMessage = {
        senderAddress,
        content: {
          subject: email.subject,
          html: email.html,
          plainText: email.text,
        },
        recipients: { to: email.to.map((address) => ({ address })) },
        replyTo: email.replyTo.map((address) => ({ address })),
      }

      let timer: NodeJS.Timeout | undefined
      const budgetSpent = new Promise<typeof BUDGET_SPENT>((resolve) => {
        timer = setTimeout(() => resolve(BUDGET_SPENT), timeoutMs)
      })
      try {
        const poller = await Promise.race([
          accept(emailClient, message),
          budgetSpent,
        ])
        if (poller === BUDGET_SPENT) {
          throw new Error(`Email send timed out after ${timeoutMs}ms`)
        }
        // ACS has accepted the message, so it counts as sent unless delivery
        // reports a failure within what is left of the budget.
        const result = await Promise.race([poll(poller), budgetSpent])
        if (result !== BUDGET_SPENT && FAILED_STATUSES.has(result.status)) {
          throw new Error("Email send failed")
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
