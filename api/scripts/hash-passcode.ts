import bcrypt from "bcryptjs"

const BCRYPT_COST = 12

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

async function main() {
  const passcode = (await readStdin()).replace(/\r?\n$/, "")
  if (passcode === "") {
    console.error("Passcode is empty; pipe it in on stdin.")
    process.exit(1)
  }
  console.log(await bcrypt.hash(passcode, BCRYPT_COST))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Hashing failed")
  process.exit(1)
})
