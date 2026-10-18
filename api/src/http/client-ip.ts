import { createHash } from "node:crypto"
import type { HttpRequest } from "@azure/functions"

function stripPort(address: string): string {
  const bracketed = address.match(/^\[([^\]]+)\](?::\d+)?$/)
  if (bracketed) return bracketed[1]
  // Only IPv4 carries a bare ":port"; a bare IPv6 address has several colons.
  return address.split(":").length === 2 ? address.split(":")[0] : address
}

// Hashed so raw guest IPs are never stored in the rate-limit table.
export function clientIpHash(request: HttpRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]
  const raw = (
    request.headers.get("x-azure-clientip") ??
    forwarded ??
    ""
  ).trim()
  const address = raw === "" ? "unknown" : stripPort(raw)
  return createHash("sha256").update(address).digest("hex")
}
