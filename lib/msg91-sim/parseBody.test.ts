import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { parseBulkBody, parseDeleteTemplateQuery, parseSessionRequest, extractTemplateFields } from "./parseBody"

const docsMinimalBulk = {
  integrated_number: "919999988888",
  content_type: "template",
  payload: {
    type: "template",
    template: {
      name: "otp_verification",
      language: { code: "en_US", policy: "deterministic" },
      to_and_components: [
        {
          to: ["919876543210"],
          components: { body_1: { type: "text", value: "123456" } },
        },
      ],
    },
  },
}

const clientBulk = {
  integrated_number: "919999988888",
  content_type: "template",
  CRQID: "trip-1",
  payload: {
    messaging_product: "whatsapp",
    type: "template",
    template: {
      name: "otp_verification",
      language: { code: "en_US", policy: "deterministic" },
      namespace: "example_namespace",
      to_and_components: [
        {
          to: ["+919876543210"],
          components: {
            body_1: { type: "text", value: "123456" },
            button_1: { subtype: "url", type: "text", value: "123456" },
          },
        },
      ],
    },
  },
}

describe("parseBulkBody", () => {
  it("accepts docs-minimal body without messaging_product or namespace", () => {
    const parsed = parseBulkBody(docsMinimalBulk)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.value.templateName, "otp_verification")
    assert.equal(parsed.value.namespace, undefined)
    assert.equal(parsed.value.recipients[0]?.to[0], "919876543210")
  })

  it("accepts client body with namespace and CRQID", () => {
    const parsed = parseBulkBody(clientBulk)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.value.namespace, "example_namespace")
    assert.equal(parsed.value.crqid, "trip-1")
    assert.equal(parsed.value.recipients[0]?.to[0], "919876543210")
  })

  it("rejects missing to_and_components", () => {
    const parsed = parseBulkBody({
      integrated_number: "91",
      content_type: "template",
      payload: { template: { name: "x", language: { code: "en" } } },
    })
    assert.equal(parsed.ok, false)
  })
})

describe("parseSessionRequest", () => {
  it("accepts docs to/from/type interactive list", () => {
    const parsed = parseSessionRequest(
      {
        to: "919876543210",
        from: "919999988888",
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: "Pick" },
          action: { button: "Choose", sections: [] },
        },
      },
      new URLSearchParams(),
    )
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.value.kind, "interactive")
    if (parsed.value.kind !== "interactive") return
    assert.equal(parsed.value.recipientNumber, "919876543210")
    assert.equal(parsed.value.integratedNumber, "919999988888")
  })

  it("accepts client recipient_number/content_type interactive buttons", () => {
    const parsed = parseSessionRequest(
      {
        recipient_number: "919876543210",
        integrated_number: "919999988888",
        content_type: "interactive",
        interactive: {
          type: "button",
          body: { text: "Quote" },
          action: {
            buttons: [{ type: "reply", reply: { id: "BOOK_TOKEN::abc", title: "Pay ₹99 to Lock" } }],
          },
        },
      },
      new URLSearchParams(),
    )
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.value.kind, "interactive")
  })

  it("accepts text query params used by buildMsg91TextOutboundUrl", () => {
    const params = new URLSearchParams({
      integrated_number: "919999988888",
      recipient_number: "919876543210",
      content_type: "text",
      text: "Hello",
    })
    const parsed = parseSessionRequest({}, params)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.value.kind, "text")
    if (parsed.value.kind !== "text") return
    assert.equal(parsed.value.text, "Hello")
  })
})

describe("parseDeleteTemplateQuery", () => {
  it("requires template_name and integrated_number query params, not a path id", () => {
    const missing = parseDeleteTemplateQuery(new URLSearchParams({ template_name: "otp_verification" }))
    assert.equal(missing.ok, false)

    const parsed = parseDeleteTemplateQuery(
      new URLSearchParams({
        template_name: "otp_verification",
        integrated_number: "+919999988888",
      }),
    )
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.value.templateName, "otp_verification")
    assert.equal(parsed.value.integratedNumber, "919999988888")
  })
})

describe("extractTemplateFields", () => {
  it("accepts Facebook-shaped components array used by quote_choice_v1", () => {
    const fields = extractTemplateFields({
      integrated_number: "919111111111",
      template_name: "quote_choice_v1",
      language: "en_US",
      category: "UTILITY",
      components: [
        { type: "BODY", text: "Trip: {{1}}" },
        { type: "FOOTER", text: "Tap a button below to choose your cab." },
        {
          type: "BUTTONS",
          buttons: [
            { type: "QUICK_REPLY", text: "Select 1" },
            { type: "QUICK_REPLY", text: "Select 2" },
            { type: "QUICK_REPLY", text: "Select 3" },
          ],
        },
      ],
    })
    assert.equal(fields.name, "quote_choice_v1")
    assert.equal(fields.language, "en_US")
    assert.equal(fields.category, "UTILITY")
    assert.equal(Array.isArray(fields.components.facebook_components), true)
  })
})
