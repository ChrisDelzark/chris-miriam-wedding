import bcrypt from "bcryptjs"

export async function checkPasscode(
  passcode: string,
  hash: string
): Promise<boolean> {
  try {
    return await bcrypt.compare(passcode, hash)
  } catch {
    // A malformed stored hash must read as a failed sign-in, not a crash.
    return false
  }
}
