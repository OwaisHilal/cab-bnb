import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import { isCancelRequestEnabled } from "@/lib/guest-trip/cancelRequestEnabled"

const ENV_KEY = "NEXT_PUBLIC_ENABLE_CANCEL_REQUEST"

describe("isCancelRequestEnabled", () => {
  const previous = process.env[ENV_KEY]

  afterEach(() => {
    if (previous === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = previous
  })

  it("stays off unless the env is exactly true", () => {
    delete process.env[ENV_KEY]
    assert.equal(isCancelRequestEnabled(), false)
    process.env[ENV_KEY] = "false"
    assert.equal(isCancelRequestEnabled(), false)
    process.env[ENV_KEY] = "1"
    assert.equal(isCancelRequestEnabled(), false)
    process.env[ENV_KEY] = "true"
    assert.equal(isCancelRequestEnabled(), true)
  })
})
