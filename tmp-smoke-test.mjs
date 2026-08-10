import { parseInboundAction } from "./lib/whatsapp/webhook/parseInboundAction.ts";

function msg(overrides) {
  return {
    waMessageId: "wamid.test",
    fromPhone: "919876543210",
    timestamp: "1700000000",
    type: "text",
    textBody: null,
    buttonPayload: null,
    interactionType: null,
    ...overrides,
  };
}

const cases = [
  [msg({ buttonPayload: "BOOK_FULL::abc-123", interactionType: "button_click" }), "book_full"],
  [msg({ buttonPayload: "BOOK_TOKEN::abc-123", interactionType: "button_click" }), "book_token"],
  [msg({ buttonPayload: "NEGOTIATE::abc-123", interactionType: "button_click" }), "negotiate"],
  [msg({ buttonPayload: "CHECKIN_OK::evt-1", interactionType: "button_click" }), "checkin_ok"],
  [msg({ buttonPayload: "CHECKIN_HELP::evt-1", interactionType: "button_click" }), "checkin_help"],
  [msg({ buttonPayload: "RATE_5::booking-1", interactionType: "list_reply" }), "rate"],
  [msg({ buttonPayload: "RATE_9::booking-1", interactionType: "list_reply" }), "unknown"],
  [msg({ textBody: "DRIVER: Bilal Ahmed | 9876543210 | JK01AB1234 | Swift Dzire", interactionType: "free_text" }), "driver_details"],
  [msg({ textBody: "hello there", interactionType: "free_text" }), "unknown"],
];

for (const [message, expected] of cases) {
  const result = parseInboundAction(message);
  const pass = result.type === expected;
  console.log(`${pass ? "PASS" : "FAIL"}: ${message.buttonPayload ?? message.textBody} -> ${result.type} (expected ${expected})`);
}

const driverResult = parseInboundAction(
  msg({ textBody: "DRIVER: Bilal Ahmed | 9876543210 | JK01AB1234 | Swift Dzire", interactionType: "free_text" }),
);
console.log("driver details parsed:", JSON.stringify(driverResult.driverDetails));
