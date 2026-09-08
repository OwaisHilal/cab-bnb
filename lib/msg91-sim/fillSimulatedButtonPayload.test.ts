import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { fillSimulatedButtonPayload } from "./fillSimulatedButtonPayload"

const SNAPSHOT_ID = "11111111-1111-4111-8111-111111111111"

describe("fillSimulatedButtonPayload", () => {
  it("keeps an explicit BOOK_TOKEN payload", () => {
    const filled = fillSimulatedButtonPayload({
      buttonPayload: `BOOK_TOKEN::${SNAPSHOT_ID}`,
      buttonText: "Select Aala Cabs",
      resolvedQuoteSnapshotId: "other-id",
    })
    assert.equal(filled.payload, `BOOK_TOKEN::${SNAPSHOT_ID}`)
    assert.equal(filled.filledFromTitle, false)
  })

  it("fills BOOK_TOKEN from a unique Select {vendor} title and snapshot", () => {
    const filled = fillSimulatedButtonPayload({
      buttonPayload: null,
      buttonText: "Select Aala Cabs",
      resolvedQuoteSnapshotId: SNAPSHOT_ID,
    })
    assert.equal(filled.payload, `BOOK_TOKEN::${SNAPSHOT_ID}`)
    assert.equal(filled.text, "Select Aala Cabs")
    assert.equal(filled.filledFromTitle, true)
  })

  it("does not fill BOOK_TOKEN from other free text", () => {
    const filled = fillSimulatedButtonPayload({
      buttonPayload: null,
      buttonText: "Need help?",
      resolvedQuoteSnapshotId: SNAPSHOT_ID,
    })
    assert.equal(filled.payload, null)
    assert.equal(filled.filledFromTitle, false)
  })

  it("does not fill BOOK_TOKEN when the title does not uniquely match a snapshot", () => {
    const filled = fillSimulatedButtonPayload({
      buttonPayload: null,
      buttonText: "Select Valley Rides",
      resolvedQuoteSnapshotId: null,
    })
    assert.equal(filled.payload, null)
    assert.equal(filled.filledFromTitle, false)
  })
})
