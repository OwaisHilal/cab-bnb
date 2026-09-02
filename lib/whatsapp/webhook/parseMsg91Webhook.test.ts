import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseInboundAction } from "./parseInboundAction";
import { isMsg91WebhookPayload, parseMsg91Webhook } from "./parseMsg91Webhook";
import { MSG91_WEBHOOK_SECRET_HEADER, verifyMsg91WebhookSecret } from "./verifyMsg91Webhook";

const QUOTE_ID = "11111111-1111-4111-8111-111111111111";

describe("isMsg91WebhookPayload", () => {
  it("accepts MSG91 Webhook (New) inbound JSON and rejects Meta envelopes", () => {
    assert.equal(
      isMsg91WebhookPayload({
        customerNumber: "917748847990",
        direction: "0",
        contentType: "text",
        text: "Hi",
      }),
      true,
    );
    assert.equal(
      isMsg91WebhookPayload({
        object: "whatsapp_business_account",
        entry: [{ changes: [{ value: { messages: [] } }] }],
      }),
      false,
    );
  });
});

describe("parseMsg91Webhook inbound buttons", () => {
  it("reads stringified quick-reply button.payload (MSG91 inbound field)", () => {
    const parsed = parseMsg91Webhook({
      customerNumber: "919876543210",
      integratedNumber: "919999988888",
      direction: "0",
      contentType: "button",
      uuid: "wamid.QR",
      ts: "2026-09-02T12:00:00+05:30",
      button: JSON.stringify({ payload: `BOOK_TOKEN::${QUOTE_ID}`, text: "Select Aala Cabs" }),
      messages: "",
      interactive: "",
    });

    assert.equal(parsed.messages.length, 1);
    assert.equal(parsed.messages[0]?.buttonPayload, `BOOK_TOKEN::${QUOTE_ID}`);
    assert.equal(parsed.messages[0]?.interactionType, "button_click");
    assert.equal(parsed.messages[0]?.textBody, "Select Aala Cabs");
    assert.equal(parseInboundAction(parsed.messages[0]!).type, "book_token");
    assert.equal(parseInboundAction(parsed.messages[0]!).quoteSnapshotId, QUOTE_ID);
  });

  it("reads session interactive button_reply.id from stringified messages", () => {
    const parsed = parseMsg91Webhook({
      customerNumber: "919876543210",
      direction: "0",
      contentType: "interactive",
      uuid: "wamid.INT",
      ts: "2026-09-02T12:00:00+05:30",
      button: "",
      interactive: JSON.stringify({
        type: "button_reply",
        button_reply: { id: `BOOK_TOKEN::${QUOTE_ID}`, title: "Select Nova Cabs" },
      }),
      messages: JSON.stringify([
        {
          from: "919876543210",
          id: "wamid.INT",
          timestamp: "1756800000",
          type: "interactive",
          interactive: {
            type: "button_reply",
            button_reply: { id: `BOOK_TOKEN::${QUOTE_ID}`, title: "Select Nova Cabs" },
          },
        },
      ]),
    });

    assert.equal(parsed.messages[0]?.buttonPayload, `BOOK_TOKEN::${QUOTE_ID}`);
    assert.equal(parsed.messages[0]?.interactionType, "button_click");
    assert.equal(parseInboundAction(parsed.messages[0]!).type, "book_token");
  });

  it("maps DRIVER: free text to driver_details", () => {
    const parsed = parseMsg91Webhook({
      companyId: "384905",
      customerNumber: "919876543210",
      customerName: "Manas",
      contentType: "text",
      text: "DRIVER: Bilal Ahmed | 9876543210 | JK01AB1234 | Swift Dzire",
      button: "",
      contacts: JSON.stringify([{ profile: { name: "Manas" }, wa_id: "919876543210" }]),
      interactive: "",
      uuid: "wamid.DRIVER",
      messages: JSON.stringify([
        {
          from: "919876543210",
          id: "wamid.DRIVER",
          timestamp: "1756115753",
          text: { body: "DRIVER: Bilal Ahmed | 9876543210 | JK01AB1234 | Swift Dzire" },
          type: "text",
        },
      ]),
      ts: "2025-08-25T15:25:55+05:30",
    });

    assert.equal(parsed.messages[0]?.interactionType, "free_text");
    assert.equal(parseInboundAction(parsed.messages[0]!).type, "driver_details");
  });
});

describe("parseMsg91Webhook outbound status", () => {
  it("maps eventName read on direction 1 to a status event, not inbound", () => {
    const parsed = parseMsg91Webhook({
      customerNumber: "919876543210",
      integratedNumber: "919999988888",
      direction: "1",
      eventName: "read",
      uuid: "wamid.OUT",
      templateName: "quote_choice_v1",
      ts: "2026-09-02T12:00:05+05:30",
    });

    assert.deepEqual(parsed.messages, []);
    assert.equal(parsed.statuses.length, 1);
    assert.equal(parsed.statuses[0]?.waMessageId, "wamid.OUT");
    assert.equal(parsed.statuses[0]?.status, "read");
  });
});

describe("verifyMsg91WebhookSecret", () => {
  it("rejects missing or mismatched secrets", () => {
    assert.equal(verifyMsg91WebhookSecret(null, "secret"), false);
    assert.equal(verifyMsg91WebhookSecret("nope", "secret"), false);
    assert.equal(verifyMsg91WebhookSecret("secret", "secret"), true);
    assert.equal(MSG91_WEBHOOK_SECRET_HEADER, "x-msg91-webhook-secret");
  });
});
