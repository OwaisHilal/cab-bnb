import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildCheckoutReturnUrl } from "@/lib/cashfree/buildCheckoutReturnUrl"

describe("buildCheckoutReturnUrl", () => {
  it("includes the session id for a token return", () => {
    const url = buildCheckoutReturnUrl({
      appBaseUrl: "https://kashmir.cab",
      confirming: "token",
      sessionId: "550e8400-e29b-41d4-a716-446655440000",
    })
    assert.equal(
      url,
      "https://kashmir.cab/?continue=1&confirming=token&sid=550e8400-e29b-41d4-a716-446655440000",
    )
  })

  it("includes the session id for a balance return", () => {
    const url = buildCheckoutReturnUrl({
      appBaseUrl: "https://kashmir.cab",
      confirming: "balance",
      sessionId: "550e8400-e29b-41d4-a716-446655440000",
    })
    assert.equal(url.includes("confirming=balance"), true)
    assert.equal(url.includes("sid=550e8400-e29b-41d4-a716-446655440000"), true)
  })

  it("encodes a session id that needs escaping", () => {
    const url = buildCheckoutReturnUrl({
      appBaseUrl: "https://kashmir.cab",
      confirming: "token",
      sessionId: "a b&c",
    })
    assert.equal(url.includes("sid=a%20b%26c"), true)
    assert.equal(url.includes("sid=a b&c"), false)
  })

  it("only emits token or balance as confirming", () => {
    const token = buildCheckoutReturnUrl({
      appBaseUrl: "https://kashmir.cab",
      confirming: "token",
      sessionId: "sid",
    })
    const balance = buildCheckoutReturnUrl({
      appBaseUrl: "https://kashmir.cab",
      confirming: "balance",
      sessionId: "sid",
    })
    assert.match(token, /confirming=token(&|$)/)
    assert.match(balance, /confirming=balance(&|$)/)
  })
})
