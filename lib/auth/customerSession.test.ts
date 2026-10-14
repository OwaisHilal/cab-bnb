import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"

import { createCustomerSessionToken, verifyCustomerSessionToken } from "./customerSession"

const ORIGINAL_SECRET = process.env.CUSTOMER_SESSION_SECRET

beforeEach(() => {
  process.env.CUSTOMER_SESSION_SECRET = "test-customer-session-secret"
})

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CUSTOMER_SESSION_SECRET
  else process.env.CUSTOMER_SESSION_SECRET = ORIGINAL_SECRET
})

describe("createCustomerSessionToken / verifyCustomerSessionToken", () => {
  it("round-trips a valid token", async () => {
    const token = await createCustomerSessionToken({ touristId: "tourist-1", phoneE164: "+919876543210" })
    const result = await verifyCustomerSessionToken(token)
    assert.deepEqual(result, { touristId: "tourist-1", phoneE164: "+919876543210" })
  })

  it("rejects a malformed token", async () => {
    assert.equal(await verifyCustomerSessionToken("not-a-token"), null)
    assert.equal(await verifyCustomerSessionToken(""), null)
  })

  it("rejects a tampered token", async () => {
    const token = await createCustomerSessionToken({ touristId: "tourist-1", phoneE164: "+919876543210" })
    const parts = token.split(".")
    const tampered = `${parts[0]}.${parts[1]}.not-a-real-signature`
    assert.equal(await verifyCustomerSessionToken(tampered), null)
  })

  it("rejects a token signed with a different secret", async () => {
    const token = await createCustomerSessionToken({ touristId: "tourist-1", phoneE164: "+919876543210" })
    process.env.CUSTOMER_SESSION_SECRET = "a-different-secret"
    assert.equal(await verifyCustomerSessionToken(token), null)
  })

  it("throws when CUSTOMER_SESSION_SECRET is not configured", async () => {
    delete process.env.CUSTOMER_SESSION_SECRET
    await assert.rejects(() => createCustomerSessionToken({ touristId: "tourist-1", phoneE164: "+919876543210" }))
  })
})
