import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseInboundAction } from "./parseInboundAction";
import { isMsg91WebhookPayload, isPaidPaymentStatus, parseMsg91Webhook } from "./parseMsg91Webhook";
import { resolvePaymentReportAction } from "@/lib/whatsapp/paymentReport";
import { MSG91_WEBHOOK_SECRET_HEADER, verifyMsg91WebhookSecret } from "./verifyMsg91Webhook";
import { parseWholeBodyPhone } from "../../drivers/phone";

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

  it("does not treat the visible Select {vendor} chat text as a tap", () => {
    const action = parseInboundAction({
      waMessageId: "wamid.SELECT_TEXT",
      fromPhone: "919876543210",
      timestamp: "2026-09-03T12:00:00+05:30",
      type: "text",
      textBody: "Select Aala Cabs",
      buttonPayload: null,
      interactionType: "free_text",
    });
    assert.equal(action.type, "unknown");
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

  it("attaches group_id on inbound group chat without treating it as a button action", () => {
    const parsed = parseMsg91Webhook({
      customerNumber: "919876543210",
      direction: "0",
      contentType: "text",
      uuid: "wamid.GROUP",
      group_id: "g.us.demo1",
      text: "See you at the airport",
    });
    assert.equal(parsed.messages[0]?.groupId, "g.us.demo1");
    assert.equal(parseInboundAction(parsed.messages[0]!).type, "unknown");
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

  it("maps a whole-body phone to driver_details", () => {
    const parsed = parseMsg91Webhook({
      customerNumber: "919876543210",
      direction: "0",
      contentType: "text",
      text: "9876500001",
      uuid: "wamid.PHONE",
      ts: "2026-09-03T12:00:00+05:30",
    });
    const action = parseInboundAction(parsed.messages[0]!);
    assert.equal(action.type, "driver_details");
    assert.equal(action.driverDetails?.phone, "9876500001");
    assert.equal(action.driverDetails?.name, undefined);
  });

  it("does not treat embedded digits as driver_details", () => {
    const action = parseInboundAction({
      waMessageId: "wamid.EMBED",
      fromPhone: "919876543210",
      timestamp: "2026-09-03T12:00:00+05:30",
      type: "text",
      textBody: "Call me at 9876500001 tonight",
      buttonPayload: null,
      interactionType: "free_text",
    });
    assert.equal(action.type, "unknown");
    assert.equal(parseWholeBodyPhone("Call me at 9876500001 tonight"), null);
    assert.equal(parseWholeBodyPhone("+91 98765 00001"), "919876500001");
  });

  it("keeps the 4-field DRIVER: regex when an optional 5th cab type is present", () => {
    const action = parseInboundAction({
      waMessageId: "wamid.DRIVER5",
      fromPhone: "919876543210",
      timestamp: "2026-09-03T12:00:00+05:30",
      type: "text",
      textBody: "DRIVER: Bilal Ahmed | 9876543210 | JK01AB1234 | Swift Dzire | Sedan",
      buttonPayload: null,
      interactionType: "free_text",
    });
    assert.equal(action.type, "driver_details");
    assert.equal(action.driverDetails?.name, "Bilal Ahmed");
    assert.equal(action.driverDetails?.phone, "9876543210");
  });

  it("maps BALANCE_PAY and COMPLETE_PAYMENT to complete_payment", () => {
    const balance = parseInboundAction({
      waMessageId: "demo",
      fromPhone: "919876543210",
      timestamp: "2026-09-03T12:00:00+05:30",
      type: "button",
      textBody: null,
      buttonPayload: `BALANCE_PAY::${QUOTE_ID}`,
      interactionType: "button_click",
    });
    assert.equal(balance.type, "complete_payment");
    assert.equal(balance.bookingId, QUOTE_ID);
    const complete = parseInboundAction({
      waMessageId: "demo",
      fromPhone: "919876543210",
      timestamp: "2026-09-03T12:00:00+05:30",
      type: "button",
      textBody: null,
      buttonPayload: `COMPLETE_PAYMENT::${QUOTE_ID}`,
      interactionType: "button_click",
    });
    assert.equal(complete.type, "complete_payment");
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

describe("parseMsg91Webhook payment reports", () => {
  it("maps On Payment Report Received paid status and CRQID", () => {
    const parsed = parseMsg91Webhook({
      customerNumber: "919876543210",
      direction: "1",
      eventName: "payment",
      webhookType: "payment",
      paymentStatus: "paid",
      crqid: QUOTE_ID,
      uuid: "wamid.PAY",
      ts: "2026-09-03T12:00:00+05:30",
      orders: JSON.stringify([{ status: "paid", amount: 99 }]),
    });

    assert.deepEqual(parsed.messages, []);
    assert.equal(parsed.payments.length, 1);
    assert.equal(parsed.payments[0]?.paid, true);
    assert.equal(parsed.payments[0]?.crqid, QUOTE_ID);
    assert.equal(parseInboundAction({
      waMessageId: "demo",
      fromPhone: "919876543210",
      timestamp: "2026-09-03T12:00:00+05:30",
      type: "button",
      textBody: null,
      buttonPayload: `TOKEN_PAY::${QUOTE_ID}`,
      interactionType: "button_click",
    }).type, "token_pay");
  });

  it("does not treat unpaid as paid", () => {
    const parsed = parseMsg91Webhook({
      customerNumber: "919876543210",
      paymentStatus: "unpaid",
      webhookType: "payment",
      crqid: QUOTE_ID,
    });

    assert.equal(parsed.payments[0]?.paid, false);
  });

  it("does not treat pending as paid", () => {
    assert.equal(isPaidPaymentStatus("pending"), false);
    assert.equal(isPaidPaymentStatus("unpaid"), false);
    assert.equal(isPaidPaymentStatus("paid"), true);
    assert.equal(isPaidPaymentStatus("SUCCESS"), true);
  });

  it("branches paid CRQID reports by intent purpose and never guesses without crqid", () => {
    assert.equal(resolvePaymentReportAction({ paid: true, crqid: QUOTE_ID }, "token_lock"), "token_lock");
    assert.equal(resolvePaymentReportAction({ paid: true, crqid: QUOTE_ID }, "balance"), "balance");
    assert.equal(resolvePaymentReportAction({ paid: true, crqid: QUOTE_ID }, "other"), "ignore");
    assert.equal(resolvePaymentReportAction({ paid: true, crqid: null }, "token_lock"), "ignore");
    assert.equal(resolvePaymentReportAction({ paid: false, crqid: QUOTE_ID }, "token_lock"), "ignore");
    assert.equal(resolvePaymentReportAction({ paid: true, crqid: QUOTE_ID }, null), "token_lock");
    assert.equal(resolvePaymentReportAction({ paid: true, crqid: QUOTE_ID }, null, QUOTE_ID), "balance");
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
