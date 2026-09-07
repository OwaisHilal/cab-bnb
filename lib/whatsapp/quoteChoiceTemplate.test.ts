import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  QUOTE_CHOICE_DASHBOARD_BODY,
  QUOTE_CHOICE_FOOTER,
  QUOTE_CHOICE_SAMPLE_BUTTON_TITLES,
  MSG91_QUOTE_CHOICE_TEMPLATE_NAME,
  QUOTE_CHOICE_UNAVAILABLE_PAYLOAD,
  WHATSAPP_QUICK_REPLY_TITLE_MAX,
  buildQuoteChoiceButtons,
  buildQuoteChoiceCreateApiBody,
  buildQuoteChoiceMsg91Components,
  buildQuoteChoiceNamedVariables,
  buildQuoteChoiceSessionButtons,
  formatQuoteChoiceLine,
  formatQuoteChoiceTripSummary,
  quoteChoiceSelectTitle,
} from "./quoteChoiceTemplate"

const sampleRows = [
  { quoteSnapshotId: "q-cheap", vendorName: "Aala Cabs", pricePerDay: 17500, rating: 4.8 },
  { quoteSnapshotId: "q-mid", vendorName: "Nova Cabs", pricePerDay: 18000, rating: 4.6 },
  { quoteSnapshotId: "q-high", vendorName: "Valley Rides", pricePerDay: 18400, rating: 4.5 },
]

describe("quote_choice_v1 copy constraints", () => {
  it("keeps footer and Select {vendor} titles within Meta/MSG91 limits", () => {
    assert.ok(QUOTE_CHOICE_FOOTER.length <= 60)
    for (const title of QUOTE_CHOICE_SAMPLE_BUTTON_TITLES) {
      assert.ok(title.length <= WHATSAPP_QUICK_REPLY_TITLE_MAX)
      assert.match(title, /^Select /)
    }
  })

  it("does not start or end the dashboard body with a variable", () => {
    assert.equal(QUOTE_CHOICE_DASHBOARD_BODY.startsWith("{{"), false)
    assert.equal(QUOTE_CHOICE_DASHBOARD_BODY.trimEnd().endsWith("}}"), false)
  })
})

describe("formatQuoteChoiceTripSummary", () => {
  it("formats days, people, cab type, and route", () => {
    assert.equal(
      formatQuoteChoiceTripSummary({
        tripDays: 3,
        paxCount: 4,
        vehicleLabel: "Sedan",
        pickupLocation: "Srinagar",
        dropLocation: "Pahalgam",
      }),
      "3 days · 4 pax · Sedan · Srinagar → Pahalgam",
    )
  })

  it("omits route when pickup or drop is missing", () => {
    assert.equal(
      formatQuoteChoiceTripSummary({
        tripDays: 1,
        paxCount: 2,
        vehicleLabel: "SUV",
      }),
      "1 day · 2 pax · SUV",
    )
  })
})

describe("formatQuoteChoiceLine", () => {
  it("formats vendor, price per day, and rating", () => {
    assert.equal(
      formatQuoteChoiceLine({ vendorName: "Aala Cabs", pricePerDay: 17500, rating: 4.8 }),
      "Aala Cabs ₹17,500/day (4.8)",
    )
  })
})

describe("buildQuoteChoiceMsg91Components", () => {
  it("fills body_1..body_4 and quick_reply payloads lowest-first", () => {
    const components = buildQuoteChoiceMsg91Components({
      tripSummary: "3 days · 4 pax · Sedan",
      rows: sampleRows,
    })

    assert.equal(components.body_1?.value, "3 days · 4 pax · Sedan")
    assert.equal(components.body_2?.value, "Aala Cabs ₹17,500/day (4.8)")
    assert.equal(components.body_3?.value, "Nova Cabs ₹18,000/day (4.6)")
    assert.equal(components.body_4?.value, "Valley Rides ₹18,400/day (4.5)")
    assert.equal(components.button_1?.subtype, "quick_reply")
    assert.equal(components.button_1?.value, "BOOK_TOKEN::q-cheap")
    assert.equal(components.button_2?.value, "BOOK_TOKEN::q-mid")
    assert.equal(components.button_3?.value, "BOOK_TOKEN::q-high")
  })

  it("pads unused quote slots so the approved 3-button template still sends", () => {
    const components = buildQuoteChoiceMsg91Components({
      tripSummary: "2 days · 3 pax · Sedan",
      rows: sampleRows.slice(0, 2),
    })
    assert.equal(components.body_4?.value, "—")
    assert.equal(components.button_3?.value, QUOTE_CHOICE_UNAVAILABLE_PAYLOAD)
  })
})

describe("buildQuoteChoiceButtons", () => {
  it("maps Select {vendorName} to BOOK_TOKEN ids in price order", () => {
    const buttons = buildQuoteChoiceButtons(sampleRows)
    assert.deepEqual(
      buttons.map((button) => button.title),
      ["Select Aala Cabs", "Select Nova Cabs", "Select Valley Rides"],
    )
    assert.equal(buttons[0]?.id, "BOOK_TOKEN::q-cheap")
  })

  it("truncates long vendor names so the title stays at 20 characters", () => {
    assert.equal(quoteChoiceSelectTitle("Kashmir Valley Travels").length, 20)
    assert.equal(quoteChoiceSelectTitle("Kashmir Valley Travels"), "Select Kashmir Valle")
  })

  it("session fallback only includes real quotes", () => {
    const buttons = buildQuoteChoiceSessionButtons(sampleRows.slice(0, 2))
    assert.equal(buttons.length, 2)
    assert.equal(buttons[1]?.title, "Select Nova Cabs")
  })
})

describe("buildQuoteChoiceNamedVariables", () => {
  it("fills named body variables for the runtime renderer", () => {
    const vars = buildQuoteChoiceNamedVariables({
      tripSummary: "3 days · 4 pax · Sedan",
      rows: sampleRows,
    })
    assert.equal(vars.trip_summary, "3 days · 4 pax · Sedan")
    assert.match(vars.quote_1 ?? "", /Aala Cabs/)
  })
})

describe("buildQuoteChoiceCreateApiBody", () => {
  it("emits Facebook-shaped BODY + FOOTER + 3 QUICK_REPLY buttons", () => {
    const body = buildQuoteChoiceCreateApiBody("+919111111111")
    assert.equal(body.template_name, MSG91_QUOTE_CHOICE_TEMPLATE_NAME)
    assert.equal(body.allow_category_change, false)
    assert.equal(body.integrated_number, "919111111111")
    assert.equal(body.category, "UTILITY")
    const types = body.components.map((component) => component.type)
    assert.deepEqual(types, ["BODY", "FOOTER", "BUTTONS"])
    const buttons = body.components[2]?.buttons as Array<{ type: string; text: string }>
    assert.equal(buttons.length, 3)
    assert.equal(buttons[0]?.type, "QUICK_REPLY")
    assert.equal(buttons[0]?.text, "Select Aala Cabs")
    assert.equal(buttons[1]?.text, "Select Nova Cabs")
    assert.equal(buttons[2]?.text, "Select Valley Rides")
  })
})
