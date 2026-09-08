import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { shouldInsertSendQuotesJob } from "./sendQuotesEnqueue"

describe("shouldInsertSendQuotesJob", () => {
  it("enqueues once from quotes_ready when no active job exists", () => {
    assert.equal(
      shouldInsertSendQuotesJob({ tripStatus: "quotes_ready", queuedOrProcessingCount: 0 }),
      true,
    )
  })

  it("does not insert a second send_quotes while one is queued or processing", () => {
    assert.equal(
      shouldInsertSendQuotesJob({ tripStatus: "quotes_ready", queuedOrProcessingCount: 1 }),
      false,
    )
    assert.equal(
      shouldInsertSendQuotesJob({ tripStatus: "otp_pending", queuedOrProcessingCount: 1 }),
      false,
    )
  })

  it("does not enqueue after quotes are already sent", () => {
    assert.equal(
      shouldInsertSendQuotesJob({ tripStatus: "quotes_sent", queuedOrProcessingCount: 0 }),
      false,
    )
  })
})
