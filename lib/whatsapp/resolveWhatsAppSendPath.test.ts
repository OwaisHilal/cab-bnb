import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { resolveWhatsAppSendPath } from "./resolveWhatsAppSendPath"
import type { WhatsAppMessageSpec } from "./types"

const quoteChoiceButtons: WhatsAppMessageSpec = {
  templateKey: "quote_choice_v1",
  bodyText: "Your Kashmir cab quotes are in.",
  buttons: [{ id: "BOOK_TOKEN::q1", title: "Select Aala Cabs" }],
  msg91Components: {
    body_1: { type: "text", value: "2 days · 2 pax" },
  },
  msg91SendMode: "template",
}

const configured = {
  msg91Configured: true,
  hasTemplateEnv: true,
}

describe("resolveWhatsAppSendPath", () => {
  it("tries Utility bulk first when approved templates are enabled", () => {
    assert.equal(
      resolveWhatsAppSendPath(quoteChoiceButtons, {
        ...configured,
        useApprovedTemplates: true,
      }),
      "bulk_template",
    )
  })

  it("sends quote_choice session buttons when approved templates are off", () => {
    assert.equal(
      resolveWhatsAppSendPath(quoteChoiceButtons, {
        ...configured,
        useApprovedTemplates: false,
      }),
      "buttons",
    )
  })

  it("does not hit bulk for text-mode specs when the flag is off", () => {
    const spec: WhatsAppMessageSpec = {
      templateKey: "driver_contact_v1",
      bodyText: "Your driver: Irfan",
      buttons: [],
      msg91Components: {
        body_1: { type: "text", value: "Irfan" },
      },
      msg91SendMode: "text",
    }
    assert.equal(
      resolveWhatsAppSendPath(spec, { ...configured, useApprovedTemplates: false }),
      "session_text",
    )
    assert.equal(
      resolveWhatsAppSendPath(spec, { ...configured, useApprovedTemplates: true }),
      "bulk_template",
    )
  })

  it("keeps quote_single on the session list path even when templates are on", () => {
    const spec: WhatsAppMessageSpec = {
      templateKey: "quote_single_v1",
      bodyText: "Your Kashmir Cab Quote",
      buttons: [],
      list: {
        buttonText: "Choose operator",
        sections: [
          {
            title: "Pay ₹99 to lock",
            rows: [{ id: "BOOK_TOKEN::q1", title: "Aala Cabs" }],
          },
        ],
      },
      msg91Components: {
        body_1: { type: "text", value: "Aala Cabs" },
      },
      msg91SendMode: "interactive",
    }
    assert.equal(
      resolveWhatsAppSendPath(spec, { ...configured, useApprovedTemplates: true }),
      "list",
    )
  })
})
