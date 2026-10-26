import { expect, test } from "vitest"
import { toWhatsAppNumber } from "../src/rsvp/phone"

test.each([
  ["0803 555 0142", "2348035550142"],
  ["+234 803 555 0142", "2348035550142"],
  ["(+44) 7700 900123", "447700900123"],
  ["2348035550142", "2348035550142"],
  ["12345", null],
  ["0803", null],
])("toWhatsAppNumber(%s)", (input, expected) =>
  expect(toWhatsAppNumber(input)).toBe(expected)
)
