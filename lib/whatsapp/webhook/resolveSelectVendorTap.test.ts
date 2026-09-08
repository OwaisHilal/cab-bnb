import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { parseInboundAction } from "./parseInboundAction"
import {
  matchUniqueSelectVendorSnapshot,
  parseSelectVendorTapText,
} from "./resolveSelectVendorTap"

const snapshots = [
  { id: "snap-aala", vendorName: "Aala Cabs" },
  { id: "snap-nova", vendorName: "Nova Cabs" },
  { id: "snap-uber", vendorName: "Uber" },
]

describe("parseSelectVendorTapText", () => {
  it("reads a Select {vendor} title", () => {
    assert.equal(parseSelectVendorTapText("Select Aala Cabs"), "Select Aala Cabs")
    assert.equal(parseSelectVendorTapText("  Select Nova Cabs  "), "Select Nova Cabs")
  })

  it("does not treat other free text as a vendor tap", () => {
    assert.equal(parseSelectVendorTapText("Need help?"), null)
    assert.equal(parseSelectVendorTapText("Select"), null)
    assert.equal(parseSelectVendorTapText(""), null)
  })
})

describe("matchUniqueSelectVendorSnapshot", () => {
  it("maps a unique Select {vendor} title to that snapshot", () => {
    assert.equal(
      matchUniqueSelectVendorSnapshot("Select Aala Cabs", snapshots),
      "snap-aala",
    )
  })

  it("stays unmatched when Valley Rides is not among the sent vendors", () => {
    assert.equal(
      matchUniqueSelectVendorSnapshot("Select Valley Rides", snapshots),
      null,
    )
  })

  it("stays unmatched when two vendors share the same truncated title", () => {
    assert.equal(
      matchUniqueSelectVendorSnapshot("Select Kashmir Valle", [
        { id: "a", vendorName: "Kashmir Valley Travels" },
        { id: "b", vendorName: "Kashmir Valley Tours" },
      ]),
      null,
    )
  })
})

describe("parseInboundAction still ignores title-only Select text", () => {
  it("does not treat the visible Select {vendor} chat text as BOOK_TOKEN", () => {
    const action = parseInboundAction({
      waMessageId: "wamid.SELECT_TEXT",
      fromPhone: "919876543210",
      timestamp: "2026-09-03T12:00:00+05:30",
      type: "text",
      textBody: "Select Aala Cabs",
      buttonPayload: null,
      interactionType: "free_text",
    })
    assert.equal(action.type, "unknown")
  })
})
