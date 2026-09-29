import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { openingQuoteWasDelivered } from "./openingQuoteDelivery"

describe("openingQuoteWasDelivered", () => {
  it("does not count a session fallback as success while templates are on", () => {
    assert.equal(
      openingQuoteWasDelivered({
        msg91SendMode: "template",
        templatesOn: true,
        send: { configured: true, success: true, channel: "session" },
      }),
      false,
    )
  })

  it("counts a successful template send", () => {
    assert.equal(
      openingQuoteWasDelivered({
        msg91SendMode: "template",
        templatesOn: true,
        send: { configured: true, success: true, channel: "template" },
      }),
      true,
    )
  })

  it("counts a session send when approved templates are off", () => {
    assert.equal(
      openingQuoteWasDelivered({
        msg91SendMode: "template",
        templatesOn: false,
        send: { configured: true, success: true, channel: "session" },
      }),
      true,
    )
  })

  it("does not count a failed template send", () => {
    assert.equal(
      openingQuoteWasDelivered({
        msg91SendMode: "template",
        templatesOn: true,
        send: { configured: true, success: false, channel: "template", error: "rejected" },
      }),
      false,
    )
  })
})
