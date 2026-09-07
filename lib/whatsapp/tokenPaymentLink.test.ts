import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { TOKEN_LOCK_AMOUNT } from "./formatInr"
import {
  TOKEN_LOCK_PAYMENT_FOOTER,
  TOKEN_LOCK_PAYMENT_MAX_DAY_LINES,
  TOKEN_LOCK_PAYMENT_TEMPLATE_KEY,
  WHATSAPP_INTERACTIVE_BODY_MAX,
  buildTokenLockItemName,
  buildTokenPaymentLinkCopy,
  formatTokenPaymentDayLines,
} from "./tokenPaymentLink"

describe("token_lock_payment_v1 copy", () => {
  it("keeps footer and item name within MSG91 limits and carts exactly ₹99", () => {
    const copy = buildTokenPaymentLinkCopy({
      trip: {
        tripDays: 5,
        paxCount: 2,
        vehicleLabel: "Sedan",
        pickupLocation: "Srinagar",
        dropLocation: "Pahalgam",
        tripStartDate: "2026-09-03",
      },
      vendor: { vendorName: "Aala Cabs", pricePerDay: 8800, rating: 3 },
    })

    assert.equal(TOKEN_LOCK_PAYMENT_TEMPLATE_KEY, "token_lock_payment_v1")
    assert.ok(TOKEN_LOCK_PAYMENT_FOOTER.length <= 60)
    assert.equal(copy.footerText, TOKEN_LOCK_PAYMENT_FOOTER)
    assert.equal(copy.amountInr, TOKEN_LOCK_AMOUNT)
    assert.equal(copy.quantity, 1)
    assert.ok(copy.itemName.length <= 60)
    assert.match(copy.bodyText, /Lock this cab with a ₹99 token/)
    assert.match(copy.bodyText, /5 days · 2 pax · Sedan/)
    assert.match(copy.bodyText, /Aala Cabs ₹8,800\/day \(3\.0\)/)
    assert.match(copy.bodyText, /Total: ₹44,000/)
    assert.match(copy.bodyText, /Balance: ₹43,901/)
    assert.match(copy.bodyText, /Day 1 · 03 Sep/)
    assert.match(copy.bodyText, /Day 5 · 07 Sep/)
  })

  it("formats day labels from a calendar date without UTC shift", () => {
    const lines = formatTokenPaymentDayLines({ tripDays: 2, tripStartDate: "2026-09-03" })
    assert.equal(lines.length, 2)
    assert.match(lines[0] ?? "", /^Day 1 · 03 Sep/)
    assert.match(lines[1] ?? "", /^Day 2 · 04 Sep/)
  })

  it("truncates long item names to 60 characters", () => {
    const name = buildTokenLockItemName("Very Long Valley Heritage Cab Company Name", 14)
    assert.ok(name.length <= 60)
  })

  it("caps day lines and keeps the interactive body within 1024 characters", () => {
    const lines = formatTokenPaymentDayLines({ tripDays: 400, tripStartDate: "2026-09-03" })
    assert.equal(lines.length, TOKEN_LOCK_PAYMENT_MAX_DAY_LINES)

    const copy = buildTokenPaymentLinkCopy({
      trip: {
        tripDays: 400,
        paxCount: 4,
        vehicleLabel: "Tempo Traveller",
        pickupLocation: "Srinagar International Airport",
        dropLocation: "Gulmarg Gondola",
        tripStartDate: "2026-09-03",
      },
      vendor: { vendorName: "Aala Cabs", pricePerDay: 18200, rating: 4.8 },
    })
    assert.ok(copy.bodyText.length <= WHATSAPP_INTERACTIVE_BODY_MAX)
  })
})
