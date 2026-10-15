import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"
import { adoptClientSessionId, sessionIdToAdopt } from "@/lib/utils/clientSession"

const SESSION_STORAGE_KEY = "kmr_booking_session_id"
const VALID_SID = "550e8400-e29b-41d4-a716-446655440000"
const OTHER_SID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

class MemorySessionStorage {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }
}

class ThrowingSetSessionStorage extends MemorySessionStorage {
  override setItem(): void {
    throw new Error("quota")
  }
}

class ThrowingSessionStorage {
  getItem(): string | null {
    throw new Error("no storage")
  }

  setItem(): void {
    throw new Error("no storage")
  }

  removeItem(): void {
    throw new Error("no storage")
  }
}

const installStorage = (storage: unknown) => {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage,
  })
}

describe("sessionIdToAdopt", () => {
  it("returns the sid only for a payment return with a UUID", () => {
    assert.equal(sessionIdToAdopt(true, VALID_SID), VALID_SID)
    assert.equal(sessionIdToAdopt(true, VALID_SID.toUpperCase()), VALID_SID.toUpperCase())
  })

  it("returns null unless continue=1 and the sid is a UUID", () => {
    assert.equal(sessionIdToAdopt(false, VALID_SID), null)
    assert.equal(sessionIdToAdopt(true, null), null)
    assert.equal(sessionIdToAdopt(true, ""), null)
    assert.equal(sessionIdToAdopt(true, "not-a-uuid"), null)
    assert.equal(sessionIdToAdopt(true, `prefix-${VALID_SID}-suffix`), null)
  })
})

describe("adoptClientSessionId", () => {
  beforeEach(() => {
    installStorage(new MemorySessionStorage())
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "sessionStorage")
  })

  it("stores a valid UUID and keeps it when storage already has the same id", () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, VALID_SID)
    assert.equal(adoptClientSessionId(VALID_SID), VALID_SID)
    assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), VALID_SID)
  })

  it("replaces a different stored id with the return URL sid", () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, OTHER_SID)
    assert.equal(adoptClientSessionId(VALID_SID), VALID_SID)
    assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), VALID_SID)
  })

  it("does not store garbage, an empty value, or a string that merely contains a UUID", () => {
    const embedded = `xx${VALID_SID}yy`
    const adopted = adoptClientSessionId(embedded)
    assert.notEqual(adopted, embedded)
    assert.match(adopted, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), adopted)
    assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY)?.includes(VALID_SID), false)

    installStorage(new MemorySessionStorage())
    const fromEmpty = adoptClientSessionId("")
    assert.notEqual(fromEmpty, "")
    assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), fromEmpty)
  })

  it("returns the valid sid when setItem throws", () => {
    installStorage(new ThrowingSetSessionStorage())
    assert.equal(adoptClientSessionId(VALID_SID), VALID_SID)
  })

  it("mints an in-memory id when the sid is invalid and storage throws", () => {
    installStorage(new ThrowingSessionStorage())
    const adopted = adoptClientSessionId("not-a-uuid")
    assert.match(adopted, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    assert.notEqual(adopted, "not-a-uuid")
  })
})
