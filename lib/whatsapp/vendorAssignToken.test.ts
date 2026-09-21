import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"

import { signVendorAssignToken, verifyVendorAssignToken } from "./vendorAssignToken"

const ORIGINAL_SECRET = process.env.VENDOR_ASSIGN_SECRET

beforeEach(() => {
  process.env.VENDOR_ASSIGN_SECRET = "test-vendor-assign-secret"
})

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.VENDOR_ASSIGN_SECRET
  else process.env.VENDOR_ASSIGN_SECRET = ORIGINAL_SECRET
})

describe("signVendorAssignToken / verifyVendorAssignToken", () => {
  it("round-trips a valid token", () => {
    const token = signVendorAssignToken({ bookingId: "booking-1", vendorId: "vendor-1" })
    const result = verifyVendorAssignToken(token)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.payload.bookingId, "booking-1")
      assert.equal(result.payload.vendorId, "vendor-1")
    }
  })

  it("rejects an expired token", () => {
    const token = signVendorAssignToken({ bookingId: "booking-1", vendorId: "vendor-1", ttlMs: -1 })
    const result = verifyVendorAssignToken(token)
    assert.deepEqual(result, { ok: false, reason: "expired" })
  })

  it("rejects a tampered payload", () => {
    const token = signVendorAssignToken({ bookingId: "booking-1", vendorId: "vendor-1" })
    const [payloadB64, signature] = token.split(".")
    const tamperedPayload = Buffer.from(JSON.stringify({ bookingId: "booking-2", vendorId: "vendor-1", exp: Date.now() + 60_000 })).toString(
      "base64url",
    )
    const tampered = `${tamperedPayload}.${signature}`
    assert.notEqual(tamperedPayload, payloadB64)
    assert.deepEqual(verifyVendorAssignToken(tampered), { ok: false, reason: "invalid_signature" })
  })

  it("rejects a tampered signature", () => {
    const token = signVendorAssignToken({ bookingId: "booking-1", vendorId: "vendor-1" })
    const [payloadB64] = token.split(".")
    const tampered = `${payloadB64}.not-a-real-signature`
    assert.deepEqual(verifyVendorAssignToken(tampered), { ok: false, reason: "invalid_signature" })
  })

  it("rejects a malformed token", () => {
    assert.deepEqual(verifyVendorAssignToken("not-a-token"), { ok: false, reason: "malformed" })
    assert.deepEqual(verifyVendorAssignToken(""), { ok: false, reason: "malformed" })
  })

  it("rejects a token signed with a different secret", () => {
    const token = signVendorAssignToken({ bookingId: "booking-1", vendorId: "vendor-1" })
    process.env.VENDOR_ASSIGN_SECRET = "a-different-secret"
    assert.deepEqual(verifyVendorAssignToken(token), { ok: false, reason: "invalid_signature" })
  })

  it("throws when VENDOR_ASSIGN_SECRET is not configured", () => {
    delete process.env.VENDOR_ASSIGN_SECRET
    assert.throws(() => signVendorAssignToken({ bookingId: "booking-1", vendorId: "vendor-1" }))
  })
})
