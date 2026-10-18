export type AppConfig = {
  storageConnectionString: string
  coupleEmails: string[]
  siteUrl: string
  adminEmails: string[]
  adminPasscodeHash: string
  sessionSecret: string
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

const MIN_SESSION_SECRET_LENGTH = 32

function emailList(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "")
}

export function readConfig(env: Record<string, string | undefined>): AppConfig {
  const value = (name: string) => env[name]?.trim() ?? ""

  const required = [
    "RSVP_STORAGE_CONNECTION_STRING",
    "COUPLE_EMAILS",
    "SITE_URL",
    "ADMIN_EMAILS",
    "ADMIN_PASSCODE_HASH",
    "ADMIN_SESSION_SECRET",
  ]
  const missing = required.filter((name) => value(name) === "")
  if (missing.length > 0) {
    throw new ConfigError(`Missing settings: ${missing.join(", ")}`)
  }

  if (value("ADMIN_SESSION_SECRET").length < MIN_SESSION_SECRET_LENGTH) {
    throw new ConfigError(
      `ADMIN_SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters`
    )
  }

  return {
    storageConnectionString: value("RSVP_STORAGE_CONNECTION_STRING"),
    coupleEmails: emailList(value("COUPLE_EMAILS")),
    siteUrl: value("SITE_URL").replace(/\/+$/, ""),
    adminEmails: emailList(value("ADMIN_EMAILS")),
    adminPasscodeHash: value("ADMIN_PASSCODE_HASH"),
    sessionSecret: value("ADMIN_SESSION_SECRET"),
  }
}
