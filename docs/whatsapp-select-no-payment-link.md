# Why Select {vendor} does not send the ₹99 payment link

Local debugging note for Kashmir BnB Cabs. This is the inbound-webhook problem, not a quote-send or `MSG91_USE_APPROVED_TEMPLATES` problem.

**Companion:** webhook setup, payload shape, and the simulator live in [`msg91-whatsapp-integration.md`](./msg91-whatsapp-integration.md) §5b and §6.

**Update (Sep 2026):** once the inbound webhook reachability problem below is fixed, the ₹99 send
itself no longer uses MSG91's `payment_link` interactive type — that type's underlying Cashfree
Orders/S2S API is blocked on this merchant account (`s2s_enabled_not_approved`). See
[`cashfree-payment-links-workaround.md`](./cashfree-payment-links-workaround.md) for the
direct-Cashfree-Payment-Links replacement now used by `lib/whatsapp/sendTokenPaymentLink.ts`.

---

## Symptom

1. Guest verifies OTP.
2. App sends the quote card (`quote_choice_v1` / MSG91 `quote_choice_v2`).
3. Guest taps **Select Aala Cabs** (or Nova / Valley Rides) in WhatsApp.
4. WhatsApp shows the tap as delivered/read (blue ticks).
5. **No ₹99 Pay Now / payment_link message follows.**

That tap is supposed to enqueue `send_token_payment_link` and send MSG91 WhatsApp Payments inside the open 24h session.

---

## What is actually broken

Two different directions of traffic:

| Direction | Who calls whom | Used for |
|-----------|----------------|----------|
| **Outbound** | This app → `control.msg91.com` | OTP SMS, quote templates, session buttons, payment_link |
| **Inbound** | MSG91 → `POST /api/whatsapp/webhook` | Guest tapped Select, vendor `DRIVER:` text, payment reports |

Quote cards work on `next dev` because **your machine can call MSG91**.

Select taps fail on `next dev` because **MSG91 cannot call `http://localhost:3000`**. WhatsApp never POSTs to this repo. Meta delivers the tap to MSG91. MSG91 then POSTs **its** JSON to the HTTPS URL configured in **Webhook (New)**. If that URL is localhost, unreachable, or a different host than the process that sent the quotes, this app never learns about the tap and never sends Pay Now.

```
Guest taps Select Aala Cabs
        │
        ▼
WhatsApp / Meta  ──►  MSG91 (BSP)
                          │
                          │  POST https://<public-host>/api/whatsapp/webhook
                          │  header x-msg91-webhook-secret
                          ▼
                 app/api/whatsapp/webhook
                          │
                          ▼
              parse BOOK_TOKEN::…  (or title fallback)
                          │
                          ▼
              job send_token_payment_link
                          │
                          ▼
              MSG91 session payment_link  (₹99)
```

If the middle POST never hits **this** `next dev` process, the right-hand side never runs.

---

## Runtime evidence (local session, Sep 2026)

After live Select taps on the quote card:

- `next dev` logged outbound success: `[whatsapp send] { mode: 'template', templateKey: 'quote_choice_v1' }`.
- `next dev` did **not** log `POST /api/whatsapp/webhook`.
- It did **not** log `[whatsapp webhook] inbound` or `[whatsapp webhook] jobs`.
- No `send_token_payment_link` job ran, so no payment_link was sent.

That is conclusive for “inbound never reached this process.” It is **not** evidence that `MSG91_WEBHOOK_SECRET` is missing, that Cashfree is down, or that the Select parser is wrong. Those only apply **after** a webhook POST arrives.

---

## `MSG91_WEBHOOK_SECRET` does not open the tunnel

`.env` already has `MSG91_WEBHOOK_SECRET`. That variable is only used **after** MSG91 successfully POSTs to `/api/whatsapp/webhook`.

The route compares header `x-msg91-webhook-secret` to `process.env.MSG91_WEBHOOK_SECRET` (`lib/whatsapp/webhook/verifyMsg91Webhook.ts`).

| Config | Effect |
|--------|--------|
| Secret set in `.env`, no public webhook URL | Quotes still send. Taps never arrive. **This is the local failure mode.** |
| Public URL, secret missing or mismatch | MSG91 POSTs; we return **500** (unset) or **401** (wrong). MSG91 may **auto-pause** the webhook on 4xx. |
| Public URL + matching secret | Auth passes; parser + job queue can run. |

Do not treat “secret is in `.env`” as “inbound is wired.” Outbound credentials (`MSG91_AUTH_KEY`, integrated number) are unrelated to inbound reachability.

---

## How to confirm you are in this failure mode

Keep `next dev` running and tap **Select {vendor}** once.

**Inbound never reached this process** (the bug this doc is about):

- No line `POST /api/whatsapp/webhook`.
- No `[whatsapp webhook] inbound`.

**Inbound reached this process** (different bug — keep investigating parser / job / payment_link):

```
POST /api/whatsapp/webhook
[whatsapp webhook] inbound { action: 'book_token', … }
[whatsapp webhook] jobs { claimed: …, succeeded: … }
```

`[quotes send] sendMode: 'template'` is **not** the inbound path. That field is the quote spec type. The tap is only visible as `POST /api/whatsapp/webhook`.

---

## Fix: give MSG91 a public HTTPS URL to this app

Pick one: tunnel to local `next dev`, or a deployed host (Vercel). MSG91 Webhook (New) must point at **the same app instance** that sent the quote (or at least the same database + MSG91 number), or you will debug the wrong process.

### A. Local development (tunnel)

1. Confirm `.env` has `MSG91_WEBHOOK_SECRET` (non-empty). Restart `next dev` after changing it.

2. In a **second** terminal, expose port 3000. Cloudflare quick tunnel:

   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

   Copy the `https://….trycloudflare.com` URL. ngrok (`ngrok http 3000`) works the same way.

3. MSG91 Dashboard → **WhatsApp** → **Webhook (New)** → create or edit the inbound webhook:

   | Field | Value |
   |-------|--------|
   | Event | **On Inbound Request Received** (required for Select taps) |
   | URL | `https://<tunnel-host>/api/whatsapp/webhook` |
   | Method | POST, content-type JSON |
   | Header | `x-msg91-webhook-secret` = same string as `.env` `MSG91_WEBHOOK_SECRET` |

   Also create **On Payment Report Received** on the same URL once you need Cashfree paid/failed callbacks. Details: [`msg91-whatsapp-integration.md`](./msg91-whatsapp-integration.md) §6.0.

4. Tunnel URLs change every time you restart a quick tunnel. Update the MSG91 URL after each restart, or use a named Cloudflare tunnel with a stable hostname.

5. Tap **Select Aala Cabs** again. `next dev` must show `POST /api/whatsapp/webhook` within a few seconds.

Windows: install `cloudflared` from [Cloudflare’s downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), then run the command in **cmd** or PowerShell (not inside the `next dev` terminal).

### B. Deployed host

Point Webhook (New) at `https://<production-or-preview-host>/api/whatsapp/webhook` and set `MSG91_WEBHOOK_SECRET` on that host (Vercel env). Do not expect `localhost` logs for taps if MSG91 is posting to Vercel.

---

## What success looks like

After a good inbound POST:

1. Terminal: `POST /api/whatsapp/webhook` **200**.
2. `[whatsapp webhook] inbound` with `action: "book_token"` (from `BOOK_TOKEN::<quote_snapshot_id>` or the `Select {vendor}` title fallback).
3. Job `send_token_payment_link` claimed; `[whatsapp webhook] jobs` succeeded.
4. Guest WhatsApp receives the ₹99 payment_link (session API, not a Utility template).

Parser: `lib/whatsapp/webhook/parseMsg91Webhook.ts` → `parseInboundAction.ts`. Title-only Utility taps (`Select Aala Cabs` with no payload) go through `resolveSelectVendorTap.ts`. Enqueue: `enqueueWebhookAction.ts`. Send: `lib/whatsapp/sendTokenPaymentLink.ts`.

---

## If the webhook arrives but Pay Now still does not

Then you are **past** this doc’s root cause. Check in order:

| Check | What you will see |
|-------|-------------------|
| Auth | `401 Invalid MSG91 webhook secret` or `500 Missing MSG91_WEBHOOK_SECRET` — header/env mismatch. 401 can pause the MSG91 webhook. |
| `action: "unknown"` | No `BOOK_TOKEN::` payload and title fallback did not uniquely match a `sent`/`viewed` snapshot for that phone. Frozen template titles (e.g. button **Select Valley Rides** while the body lists Uber) can fail unique match. |
| Duplicate skip | Same WAMID (`uuid`) already logged; second tap is ignored. |
| Job error | `send_token_payment_link` fails: snapshot missing/finalized, Cashfree Payment Link create error, or the `cta_url` send error. See [`cashfree-payment-links-workaround.md`](./cashfree-payment-links-workaround.md). |
| 24h window | The `cta_url` button is session-only, same as the old `payment_link` type. A successful quote template send usually opens the window; SMS OTP alone does not. |

---

## Prove the payment job without a live MSG91 tap

Use this when you want to test `send_token_payment_link` without a tunnel. It POSTs a fake Webhook (New) body to the same route.

Requires `MSG91_WEBHOOK_SECRET` so the simulator can call `/api/whatsapp/webhook`. Auth header `authkey` is `MSG91_SIM_AUTH_KEY` or `MSG91_AUTH_KEY`.

Use the real `quote_snapshots.id` (not the button title). Phone must match the tourist on that trip.

```bash
curl -sS -X POST http://localhost:3000/api/internal/msg91/simulate/webhook ^
  -H "authkey: YOUR_MSG91_AUTH_KEY" ^
  -H "content-type: application/json" ^
  -d "{\"kind\":\"button\",\"customerNumber\":\"91XXXXXXXXXX\",\"buttonPayload\":\"BOOK_TOKEN::<quote_snapshot_uuid>\",\"buttonText\":\"Select Aala Cabs\"}"
```

Unix:

```bash
curl -sS -X POST http://localhost:3000/api/internal/msg91/simulate/webhook \
  -H "authkey: $MSG91_AUTH_KEY" \
  -H "content-type: application/json" \
  -d '{
    "kind": "button",
    "customerNumber": "91XXXXXXXXXX",
    "buttonPayload": "BOOK_TOKEN::<quote_snapshot_uuid>",
    "buttonText": "Select Aala Cabs"
  }'
```

A successful simulate should log `POST /api/whatsapp/webhook` and send the ₹99 `cta_url` button (linking to a freshly-created Cashfree Payment Link) to that WhatsApp number. That proves the **job + Cashfree Payment Links + MSG91 send** path — see [`cashfree-payment-links-workaround.md`](./cashfree-payment-links-workaround.md). It does **not** prove live MSG91 Webhook (New) is pointed at your machine — only the tunnel/dashboard steps above do that.

---

## Related files

| Piece | File |
|-------|------|
| Webhook route | `app/api/whatsapp/webhook/route.ts` |
| MSG91 parse | `lib/whatsapp/webhook/parseMsg91Webhook.ts` |
| `BOOK_TOKEN` / title fallback | `parseInboundAction.ts`, `resolveSelectVendorTap.ts` |
| Enqueue | `lib/whatsapp/webhook/enqueueWebhookAction.ts` |
| ₹99 send (Cashfree Payment Link + WhatsApp `cta_url`) | `lib/whatsapp/sendTokenPaymentLink.ts`, [`cashfree-payment-links-workaround.md`](./cashfree-payment-links-workaround.md) |
| Simulator | `app/api/internal/msg91/simulate/webhook/route.ts` |

---

*Last updated: September 2026 — local Select taps produced no `POST /api/whatsapp/webhook`; outbound quote template send succeeded.*
