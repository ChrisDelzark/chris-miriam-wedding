export function toWhatsAppNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, "")
  if (digits.startsWith("0") && digits.length === 11) {
    return `234${digits.slice(1)}`
  }
  if (digits.length >= 10 && digits.length <= 15) return digits
  return null
}
