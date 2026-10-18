import { expect, test } from "vitest"
import { ConfigError, readConfig } from "../src/config"

const env = {
  RSVP_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
  COUPLE_EMAILS: "a@x.com, B@x.com",
  SITE_URL: "https://site.example/",
  ADMIN_EMAILS: "A@x.com,c@x.com",
  ADMIN_PASSCODE_HASH: "$2b$10$h",
  ADMIN_SESSION_SECRET: "s".repeat(32),
}

test("parses lists, lowercases emails, trims trailing slash", () => {
  expect(readConfig(env)).toMatchObject({
    coupleEmails: ["a@x.com", "b@x.com"],
    adminEmails: ["a@x.com", "c@x.com"],
    siteUrl: "https://site.example",
  })
})

test("names every missing or blank setting without values", () => {
  expect(() =>
    readConfig({ ...env, COUPLE_EMAILS: " ", ADMIN_SESSION_SECRET: undefined })
  ).toThrow(
    /COUPLE_EMAILS.*ADMIN_SESSION_SECRET|ADMIN_SESSION_SECRET.*COUPLE_EMAILS/
  )
})

test("rejects a short session secret", () => {
  expect(() => readConfig({ ...env, ADMIN_SESSION_SECRET: "short" })).toThrow(
    ConfigError
  )
})

test("treats lists with no addresses as missing", () => {
  expect(() =>
    readConfig({ ...env, COUPLE_EMAILS: " , ", ADMIN_EMAILS: "," })
  ).toThrow(/COUPLE_EMAILS.*ADMIN_EMAILS/)
})
