import type { EmailMessage } from "@azure/communication-email"
import { describe, expect, it } from "vitest"
import { createAzureEmailSender } from "../src/email/email-service"

const email = {
  to: ["a@x.com", "b@x.com"],
  replyTo: ["c@x.com"],
  subject: "Subject",
  html: "<p>Hi</p>",
  text: "Hi",
}

function fakeClient(onSend: (message: EmailMessage) => Promise<unknown>) {
  return {
    beginSend: async (message: EmailMessage) => ({
      pollUntilDone: () => onSend(message),
    }),
  } as never
}

describe("createAzureEmailSender", () => {
  it("sends to all recipients with reply-to", async () => {
    let sent: EmailMessage | undefined
    const sender = createAzureEmailSender({
      connectionString: "endpoint=https://x;accesskey=k",
      senderAddress: "from@x.com",
      timeoutMs: 1000,
      clientFactory: () =>
        fakeClient(async (message) => {
          sent = message
          return {}
        }),
    })

    await sender.send(email)

    expect(sent?.senderAddress).toBe("from@x.com")
    expect(sent?.recipients.to).toEqual([
      { address: "a@x.com" },
      { address: "b@x.com" },
    ])
    expect(sent?.replyTo).toEqual([{ address: "c@x.com" }])
    expect(sent?.content).toEqual({
      subject: "Subject",
      html: "<p>Hi</p>",
      plainText: "Hi",
    })
  })

  it("rejects when not configured", async () => {
    const sender = createAzureEmailSender({
      connectionString: undefined,
      senderAddress: "from@x.com",
      timeoutMs: 1000,
    })

    await expect(sender.send(email)).rejects.toThrow(/not configured/)
  })

  it("rejects after the timeout", async () => {
    const sender = createAzureEmailSender({
      connectionString: "endpoint=https://x;accesskey=k",
      senderAddress: "from@x.com",
      timeoutMs: 20,
      clientFactory: () => fakeClient(() => new Promise(() => {})),
    })

    const started = Date.now()
    await expect(sender.send(email)).rejects.toThrow(/timed out/)
    expect(Date.now() - started).toBeLessThan(200)
  })

  it("error never contains the connection string", async () => {
    const sender = createAzureEmailSender({
      connectionString: "endpoint=https://x;accesskey=SECRET",
      senderAddress: "from@x.com",
      timeoutMs: 1000,
      clientFactory: () => {
        throw new Error("bad endpoint=https://x;accesskey=SECRET")
      },
    })

    const error = await sender.send(email).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain("SECRET")
  })

  it("does not cache a failed client creation", async () => {
    let calls = 0
    const sender = createAzureEmailSender({
      connectionString: "endpoint=https://x;accesskey=k",
      senderAddress: "from@x.com",
      timeoutMs: 1000,
      clientFactory: () => {
        calls += 1
        if (calls === 1) throw new Error("boom")
        return fakeClient(async () => ({}))
      },
    })

    await expect(sender.send(email)).rejects.toThrow()
    await expect(sender.send(email)).resolves.toBeUndefined()
  })
})
