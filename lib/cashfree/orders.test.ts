import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"

// orders.ts starts with `import "server-only"`, which unconditionally
// throws outside Next's server bundler (see node_modules/server-only) —
// run this file (and `npm test`, which already does) with
// `tsx --conditions=react-server`, the export condition that resolves
// "server-only" to its no-op `empty.js` instead.
import { createCashfreeOrder, isCashfreeOrdersConfigured } from "./orders"

const ENV_KEYS = ["CASHFREE_CLIENT_ID", "CASHFREE_SECRET_KEY", "CASHFREE_API_VERSION", "CASHFREE_ENVIRONMENT"] as const

const savedEnv: Record<string, string | undefined> = {}
for (const key of ENV_KEYS) savedEnv[key] = process.env[key]

const restoreEnv = (): void => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
}

const originalFetch = global.fetch

afterEach(() => {
  restoreEnv()
  global.fetch = originalFetch
})

describe("isCashfreeOrdersConfigured / createCashfreeOrder", () => {
  it("reports unconfigured and refuses to call fetch when credentials are missing", async () => {
    delete process.env.CASHFREE_CLIENT_ID
    delete process.env.CASHFREE_SECRET_KEY

    assert.equal(isCashfreeOrdersConfigured(), false)

    let fetchCalled = false
    global.fetch = (async () => {
      fetchCalled = true
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await createCashfreeOrder({
      orderId: "crqid-1",
      orderAmount: 99,
      customer: { customerId: "919876543210", customerPhone: "+919876543210" },
      returnUrl: "https://cab-bnb.vercel.app/pay/token/crqid-1?order_id={order_id}",
      notifyUrl: "https://cab-bnb.vercel.app/webhooks/cashfree",
    })

    assert.equal(fetchCalled, false)
    assert.equal(result.success, false)
    assert.equal(result.configured, false)
  })

  it("returns the parsed session on a successful create", async () => {
    process.env.CASHFREE_CLIENT_ID = "test-client-id"
    process.env.CASHFREE_SECRET_KEY = "test-secret-key"
    process.env.CASHFREE_ENVIRONMENT = "sandbox"

    let capturedUrl = ""
    let capturedHeaders: Record<string, string> = {}
    global.fetch = (async (input: unknown, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = (init?.headers as Record<string, string>) ?? {}
      return new Response(
        JSON.stringify({
          order_id: "crqid-1",
          cf_order_id: 2149460581,
          payment_session_id: "session_abc123",
          order_status: "ACTIVE",
          order_expiry_time: "2026-09-18T00:00:00+05:30",
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const result = await createCashfreeOrder({
      orderId: "crqid-1",
      orderAmount: 99,
      customer: { customerId: "919876543210", customerPhone: "+919876543210" },
      returnUrl: "https://cab-bnb.vercel.app/pay/token/crqid-1?order_id={order_id}",
      notifyUrl: "https://cab-bnb.vercel.app/webhooks/cashfree",
    })

    assert.equal(capturedUrl, "https://sandbox.cashfree.com/pg/orders")
    assert.equal(capturedHeaders["x-client-id"], "test-client-id")
    assert.equal(capturedHeaders["x-client-secret"], "test-secret-key")
    assert.equal(capturedHeaders["x-api-version"], "2023-08-01")

    assert.equal(result.success, true)
    assert.equal(result.configured, true)
    assert.equal(result.orderId, "crqid-1")
    assert.equal(result.cfOrderId, "2149460581")
    assert.equal(result.paymentSessionId, "session_abc123")
    assert.equal(result.orderStatus, "ACTIVE")
  })

  it("surfaces the Cashfree error message on a non-2xx response", async () => {
    process.env.CASHFREE_CLIENT_ID = "test-client-id"
    process.env.CASHFREE_SECRET_KEY = "test-secret-key"

    global.fetch = (async () =>
      new Response(JSON.stringify({ message: "order_id already exists" }), { status: 409 })) as typeof fetch

    const result = await createCashfreeOrder({
      orderId: "crqid-1",
      orderAmount: 99,
      customer: { customerId: "919876543210", customerPhone: "+919876543210" },
      returnUrl: "https://cab-bnb.vercel.app/pay/token/crqid-1?order_id={order_id}",
      notifyUrl: "https://cab-bnb.vercel.app/webhooks/cashfree",
    })

    assert.equal(result.success, false)
    assert.equal(result.configured, true)
    assert.equal(result.error, "order_id already exists")
  })
})
