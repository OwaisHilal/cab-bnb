# How the ₹99 token payment_link is sent via MSG91

This documents the exact API call, payload shape, and code path used to send
the ₹99 token-lock "Pay Now" WhatsApp message after a tourist taps
**Select {vendor}** on a quote card.

## API endpoint

```
POST https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/
```

- **Updated 2026-09-14:** MSG91 support explicitly confirmed `api.msg91.com`
  is the correct host for `payment_link` sends — `control.msg91.com` (used
  for every other session/interactive send type below) accepts and queues
  the message fine but does not correctly carry through the Cashfree S2S
  order-creation step, producing `s2s_enabled_not_approved` even though the
  message itself reports `success: true`. See `MSG91_WHATSAPP_PAYMENT_LINK_URL`
  in [`lib/msg91/pure.ts`](../lib/msg91/pure.ts).
- Every other message type on this generic outbound endpoint (buttons,
  lists, CTA-URL messages, images, session text) still uses
  `control.msg91.com` — those are independently confirmed working.
- Only usable inside the 24-hour WhatsApp customer-care session window (the
  window opened here by the `quote_choice_v2` template message).

### Headers

| Name | Value |
| --- | --- |
| `accept` | `application/json` |
| `authkey` | `MSG91_AUTH_KEY` (from env) |
| `content-type` | `application/json` |

## Request body

Built by `buildMsg91PaymentLinkBody()` in
[`lib/msg91/pure.ts`](../lib/msg91/pure.ts):

```json
{
  "recipient_number": "917889418789",
  "integrated_number": "919103210746",
  "content_type": "interactive",
  "CRQID": "cb925fbb-a028-40c0-bde7-1f8d54ca923a",
  "interactive": {
    "type": "payment_link",
    "header": {
      "type": "image",
      "image": {
        "link": "https://.../payment-link-header.png"
      }
    },
    "body": {
      "text": "Lock this cab with a ₹99 token.\n\nTrip: 5 days · 2 pax · Sedan\nAala Cabs ₹8,800/day (3.0)\nTotal: ₹44,000 · Token: ₹99 · Balance: ₹43,901\n\nDays\n• Day 1 · 15 Aug\n• Day 2 · 16 Aug\n• Day 3 · 17 Aug\n• Day 4 · 18 Aug\n• Day 5 · 19 Aug"
    },
    "footer": {
      "text": "Pay ₹99 to lock this cab."
    },
    "items": [
      {
        "name": "Token lock · Aala Cabs · 5 days",
        "amount": 99,
        "quantity": 1
      }
    ]
  }
}
```

### Field notes

| Field | Source | Notes |
| --- | --- | --- |
| `recipient_number` | tourist's `phone_e164`, `+` stripped | `stripE164Plus()` |
| `integrated_number` | `MSG91_WHATSAPP_INTEGRATED_NUMBER` env | our WABA number |
| `content_type` | always `"interactive"` | fixed for this message type |
| `CRQID` | `whatsapp_payment_intents.id` (a fresh UUID per quote) | **Not** in MSG91's generic docs example, but documented separately in MSG91's [How to pass CRQID](https://msg91.com/help/whatsapp/how-to-pass-crqid-in-whatsapp-) article. Returned back to us on the `On Payment Report Received` webhook so we know which payment intent got paid/failed. Only sent if present (root-level, optional). |
| `interactive.type` | always `"payment_link"` | tells MSG91 to render the Cashfree-backed Pay Now card |
| `interactive.header.image.link` | `MSG91_PAYMENT_LINK_HEADER_IMAGE_URL` env (optional) | public HTTPS image URL; omitted if unset or if the first send attempt with it fails (see retry below) |
| `interactive.body.text` | `buildTokenPaymentLinkCopy()` in [`lib/whatsapp/tokenPaymentLink.ts`](../lib/whatsapp/tokenPaymentLink.ts) | trip summary, vendor line, total/token/balance, day-by-day list; capped at 1024 chars |
| `interactive.footer.text` | fixed string `"Pay ₹99 to lock this cab."` | capped at 60 chars |
| `interactive.items[].name` | `Token lock · {vendor} · {N days}` | capped at 60 chars |
| `interactive.items[].amount` | always `99` (`TOKEN_LOCK_AMOUNT`) | sent as a JSON **number**, not a string |
| `interactive.items[].quantity` | always `1` | sent as a JSON **number** |

## Code path

1. **`handleSendTokenPaymentLink()`** — [`lib/whatsapp/sendTokenPaymentLink.ts`](../lib/whatsapp/sendTokenPaymentLink.ts)
   Runs as the `send_token_payment_link` job (enqueued by the WhatsApp webhook
   when a `BOOK_TOKEN::{quote_snapshot_id}` button is tapped). Loads the quote
   snapshot + trip + vendor, builds the copy, creates/looks up a
   `whatsapp_payment_intents` row (its `id` becomes `CRQID`), then calls:

2. **`sendWhatsAppPaymentLinkMessageWithHeaderRetry()`** — [`lib/whatsapp/sendOutbound.ts`](../lib/whatsapp/sendOutbound.ts)
   Tries the send once with the header image (if configured); if that attempt
   fails, retries once **without** the header image (`paymentLinkHeaderAttempts()`
   in [`lib/whatsapp/paymentReport.ts`](../lib/whatsapp/paymentReport.ts)).
   Returns the first successful result, or the last failure.

3. **`sendWhatsAppPaymentLinkMessage()`** → **`sendMsg91PaymentLinkMessage()`** — [`lib/msg91/sendSession.ts`](../lib/msg91/sendSession.ts)
   Reads MSG91 credentials (`MSG91_AUTH_KEY`, `MSG91_WHATSAPP_INTEGRATED_NUMBER`)
   from env via `readMsg91Credentials()`.

4. **`sendMsg91PaymentLinkWithConfig()`** → **`buildMsg91PaymentLinkBody()`** — [`lib/msg91/pure.ts`](../lib/msg91/pure.ts)
   Builds the JSON body shown above and POSTs it to
   `MSG91_WHATSAPP_OUTBOUND_URL` via the shared `postMsg91Request()` helper,
   which sets the headers, checks `response.ok` and MSG91's own
   `hasError`/`type: "error"`/`status` fields, and maps the response to
   `{ configured, success, waMessageId, error }`.

## Known limitation: MSG91's synchronous response doesn't reflect Cashfree

`postMsg91Request()` only inspects MSG91's immediate HTTP response — it has
**no way to know** whether MSG91's backend successfully created the Cashfree
order behind the scenes. MSG91 accepts and queues the WhatsApp message
synchronously; the actual Cashfree order-creation call happens asynchronously
afterward. If that later step fails, the outbound send is still logged as
`success: true` on our side, and the tourist simply never receives a working
Pay Now card.

The only way to see that failure is to query MSG91's own delivery report API
directly (`GET https://control.msg91.com/api/v5/report/logs/wa`), which is
what [`scripts/msg91-whatsapp-report-ping.ts`](../scripts/msg91-whatsapp-report-ping.ts)
does. As of this writing, every real attempt fails there with:

```json
{
  "code": "s2s_enabled_not_approved",
  "message": "POST/orders/pay is not enabled or approved. Please reach out to care@cashfree.com.",
  "type": "feature_not_enabled"
}
```

This is a Cashfree merchant-account permission (Server-to-Server Orders API),
not a bug in the payload or code above — see
[`docs/whatsapp-select-no-payment-link.md`](./whatsapp-select-no-payment-link.md)
for the full investigation history.
