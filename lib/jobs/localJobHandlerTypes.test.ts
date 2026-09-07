import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { LOCAL_JOB_HANDLER_TYPES, SEND_QUOTES_JOB_TYPE } from "./localJobHandlerTypes"

describe("local job handler types", () => {
  it("includes send_quotes so OTP verify can drain the quote job without Edge", () => {
    assert.equal(SEND_QUOTES_JOB_TYPE, "send_quotes")
    assert.equal(LOCAL_JOB_HANDLER_TYPES.includes(SEND_QUOTES_JOB_TYPE), true)
  })
})
