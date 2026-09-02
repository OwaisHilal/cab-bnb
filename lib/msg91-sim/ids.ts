import { randomBytes } from "node:crypto"

export function stripPhone(phone: string): string {
  return phone.trim().replace(/^\+/, "")
}

export function newRequestId(): string {
  return randomBytes(16).toString("hex")
}

export function newWamid(): string {
  return `wamid.${randomBytes(32).toString("base64url")}`
}

export function newGroupId(): string {
  return `120363${randomBytes(8).toString("hex")}@g.us`
}

export function newJoinRequestId(): string {
  return `jr.${randomBytes(12).toString("hex")}`
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

export function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
}
