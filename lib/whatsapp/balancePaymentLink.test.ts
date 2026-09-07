import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { TOKEN_LOCK_AMOUNT } from "./formatInr"
import {
  DRIVER_ASSIGNED_PAYMENT_FOOTER,
  DRIVER_ASSIGNED_PAYMENT_TEMPLATE_KEY,
  WHATSAPP_INTERACTIVE_BODY_MAX,
  buildBalanceItemName,
  buildBalancePaymentLinkCopy,
  calculateBalanceDue,
} from "./balancePaymentLink"

describe("calculateBalanceDue", () => {
  it("subtracts the ₹99 token from trip total", () => {
    assert.equal(calculateBalanceDue(8800, 5), 8800 * 5 - TOKEN_LOCK_AMOUNT)
    assert.equal(calculateBalanceDue(99, 1), 0)
  })

  it("never returns a negative balance", () => {
    assert.equal(calculateBalanceDue(0, 1), 0)
    assert.equal(calculateBalanceDue(50, 1), 0)
  })
})

describe("driver_assigned_payment_v1 copy", () => {
  it("keeps footer and item name within MSG91 limits and carts the remaining amount", () => {
    const copy = buildBalancePaymentLinkCopy({
      tripDays: 5,
      paxCount: 2,
      vehicleLabel: "Sedan",
      pickupLocation: "Srinagar",
      dropLocation: "Pahalgam",
      vendorName: "Aala Cabs",
      pricePerDay: 8800,
      rating: 3,
      driverName: "Bilal Ahmed",
      vehicleModel: "Dzire",
      vehicleNumber: "JK01NO1234",
      balanceDue: calculateBalanceDue(8800, 5),
    })

    assert.equal(DRIVER_ASSIGNED_PAYMENT_TEMPLATE_KEY, "driver_assigned_payment_v1")
    assert.ok(DRIVER_ASSIGNED_PAYMENT_FOOTER.length <= 60)
    assert.equal(copy.footerText, DRIVER_ASSIGNED_PAYMENT_FOOTER)
    assert.equal(copy.amountInr, 8800 * 5 - TOKEN_LOCK_AMOUNT)
    assert.equal(copy.quantity, 1)
    assert.ok(copy.itemName.length <= 60)
    assert.ok(copy.bodyText.length <= WHATSAPP_INTERACTIVE_BODY_MAX)
    assert.match(copy.bodyText, /Your driver has been assigned/)
    assert.match(copy.bodyText, /Bilal Ahmed/)
    assert.match(copy.bodyText, /Token paid: ₹99/)
    assert.match(copy.bodyText, /Balance: ₹43,901/)
  })

  it("truncates long item names to 60 characters", () => {
    const name = buildBalanceItemName("Very Long Valley Heritage Cab Company Name", 14)
    assert.ok(name.length <= 60)
  })
})
