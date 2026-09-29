# Website trip booking and payment

The guest can finish a cab booking on the website and on WhatsApp. Both channels read and write one trip. The website shows the same guest steps WhatsApp already sends, as a page, in the same order, with the same facts and the same action.

Date: 2026-09-29.

## Decisions

- One trip in progress per verified phone. A second trip waits until this one is cancelled or the balance is confirmed. A finished driver-contact trip still opens on return until a newer trip starts.
- A new visit asks for the phone and OTP again. A refresh in the same tab reopens the trip without OTP.
- The browser keeps one copy of the trip, loaded from the server. The server decides which guest step that trip is on.
- Choosing an operator, paying ₹99, and paying the balance on the site call the same server paths WhatsApp already uses.
- WhatsApp messages still go out. A failed send does not block the website step.
- Cancel is available on the trip page for now, including after payment. This is a temporary testing control and will be tightened later.
- Vendor assign-driver, the driver assignment text, reminders, check-in, and the review stay on WhatsApp only.
- The page is not a fake WhatsApp chat, and it is not a custom stepper with different information than the messages.

## What starts a trip

The request form and the one-time code stay as they are today (`features/booking-request`, `features/whatsapp-otp`).

The moment the code is accepted, `completePhoneVerification` already links the tourist and enqueues `send_quotes`. At that same moment the site opens the trip’s first screen. WhatsApp sends the quote template. The guest stays on the site. WhatsApp is the parallel copy of that step.

If the template is slow or fails, the site still shows the quotes from `quote_snapshots`. Select on the site still locks the operator. The WhatsApp send is retried.

If no operators match, the form keeps today’s error. No trip screen opens and no WhatsApp template is sent.

## What the guest sees

Each step uses the copy and facts in `docs/whatsapp-message-flow.md`. The site may use the operator’s real name on a button. WhatsApp template titles are sometimes static; the site is not.

Sample used below: 2 days, 2 travellers, Innova, Srinagar Airport → Pahalgam, Aala Cabs lowest.

### 1. Quotes — `quote_choice_v1`

Shown while quotes exist and no operator is locked.

- “Your Kashmir cab quotes are in.”
- Trip line.
- Each operator with price and rating, lowest first.
- One Select button per operator, for example Select Aala Cabs.
- One operator uses the single-quote message. Two or three use the choice message.

Select is the same action as a WhatsApp `BOOK_TOKEN` tap: `send_token_payment_link`. That locks the quote, creates or reuses the ₹99 payment, and sends the lock message on WhatsApp.

Until the quote rows exist, this step shows the trip summary and “Your Kashmir cab quotes are in” is replaced by a calm waiting line. There is no second vendor-search animation after the request form.

### 2. Lock — `token_lock_payment_v1`

Shown after an operator is chosen and the ₹99 payment is not confirmed.

- “Lock this cab with a ₹99 token.”
- Trip line, chosen operator line, day lines, total, token, and balance.
- One Pay ₹99 button.

Pay opens Cashfree for that payment intent. The return URL comes back to this trip, not to a page that says go back to WhatsApp. The current `/pay/token/[crqid]` page remains a valid entry from the WhatsApp link, and it returns the guest into this same trip.

### 3. Token received — `token_received_v1`

Shown after Cashfree has confirmed ₹99 and no driver is assigned yet.

- “Payment received. Your ₹99 token is confirmed.”
- Trip line and operator name.
- “We are allocating a driver for you. This can take about 30 minutes.”
- No pay button.

The vendor assign-driver WhatsApp still goes out. The guest site does not show that vendor step.

### 4. Balance — `driver_assigned_payment_v1`

Shown after a driver is assigned and the balance is not confirmed.

- “Your driver has been assigned.”
- Trip line, operator line, driver name and vehicle.
- Total, token paid, balance.
- One Pay balance button.
- The driver phone number is not on this step.

### 5. Driver contact — `driver_contact_v1`

Shown after the balance is confirmed.

- “Payment received.”
- Driver name, phone, Call, WhatsApp, vehicle, operator.
- “Driver will reach out before pickup. Safe travels!”
- When a ride-group invite exists (`ride_group_guest_v1`), Join ride group appears here. The group is created when the booking is fully paid and ready for pickup, not at the moment of payment.

## Identity

The phone number on the tourist row is the identity of the trip. The browser is not.

- Same tab, including refresh: `sessionStorage` still has the tab session (`lib/utils/clientSession.ts`). The trip id for that session is reloaded from the server. No OTP.
- Tab closed, new device, or incognito: the database still has the phone, and this browser does not. The guest enters the phone and OTP. The server then opens that phone’s current trip on its current step. Current means the in-progress trip, or the latest finished driver-contact trip if no newer trip has started.
- A phone with no trip to resume returns to the home screen to start one.

The request form does not know the phone yet, so it can still create a trip request before OTP, as it does today. If that OTP phone already has a trip in progress, the new unlinked request is discarded and the in-progress trip opens, with a line that they already have a trip in progress.

Driver phone and payment session details are returned only to the tab session that verified that phone, or to the OTP that just verified it. Today `GET /api/trip-requests/[id]` is readable by anyone who knows the id and returns only quote fields. The fuller trip read must not follow that pattern.

## One open trip

A trip is in progress until the balance is confirmed (the driver-contact step) or until it is cancelled. One verified phone has at most one trip in progress.

A return visit with no newer trip opens the latest non-cancelled trip, including a finished driver-contact trip, so the guest can still see the driver phone. Starting a new request is blocked only while a trip is in progress. After driver contact, a new request is allowed. Cancel is how a trip still in progress is abandoned so the same phone can start another one. Two in-progress trips at once need a second phone, or a cancel of the first.

## Cancel

Cancel is on the trip page at every step, including after payment. It is temporary and will be restricted later.

- The trip is marked closed in the database.
- This tab’s memory of the trip is cleared.
- The guest lands on the home screen.
- Later WhatsApp buttons for that trip do nothing to a new trip.
- A Cashfree confirmation that arrives after cancel does not start the driver step and does not message the vendor again.
- If the vendor was already sent the assign-driver message, that message is already on their phone.

## Sync and failure handling

The trip record is the source of truth. The site shows the latest guest step that record can prove. WhatsApp is notified of that same step. The site polls one snapshot while the tab is open. There is no browser database subscription in this version.

- Quote template fails: the quotes page still renders. Select still locks the operator. The WhatsApp send is retried.
- ₹99 WhatsApp message fails: the lock page still renders, because the payment exists. Pay works on the site. The WhatsApp send is retried.
- WhatsApp locked an operator first: the next refresh shows the lock page and the other operators are gone. A later Select for a different operator is ignored.
- Both channels choose at once: the first successful lock wins. The other screen catches up on refresh.
- Checkout abandoned: Pay returns on the lock page and reuses the same payment.
- Cashfree is slow: the lock page shows “Confirming your payment” and hides Pay. The token-received screen appears only after the payment is confirmed in our database. The balance step uses the same wait.
- Payment already confirmed: Pay does not open a second checkout. The screen moves to token received, or to driver contact if the confirmed payment was the balance. This check happens before checkout is opened, including when our row is still behind Cashfree.
- The other device pays: this screen catches up on refresh and hides Pay.
- The tab loses the network: the last step stays on screen and the poll retries. The guest is not sent home and a new trip is not started.
- A driver is assigned while token payment is still confirming: the screen jumps to the latest proven step.
- Refresh in the same tab: the current step reloads without OTP.
- An old WhatsApp pay link after the payment is confirmed opens the trip at the next step and does not charge again.
- An old WhatsApp link after cancel says the trip is closed.

A payment counts only after the Cashfree webhook confirms it (`app/webhooks/cashfree/route.ts`). The site does not mark an intent paid on its own.

## Server model

One projection is built on the server from the rows WhatsApp already uses: `trip_requests`, `quote_snapshots`, `whatsapp_payment_intents`, `bookings`, driver and vehicle fields, and the ride-group invite when it exists.

The step is derived in one place:

| Proven state | Guest step |
|---|---|
| No quote rows yet | Quotes, waiting |
| Quote rows exist, no ₹99 payment intent | Quotes |
| ₹99 payment intent exists, not confirmed | Lock |
| ₹99 confirmed, no driver assigned | Token received |
| Driver assigned, balance not confirmed | Balance |
| Balance confirmed | Driver contact |
| Trip cancelled | Home |

An operator is chosen only when that ₹99 payment intent exists. If Select does not manage to create the intent, the guest stays on Quotes and can Select again. A later Select for a different operator is ignored once the intent exists.

The client stores that one response. It does not keep a second booking summary beside it. The 2026-09-28 revert happened because the screen tracked the trip three times (`booking`, a live journey poll, and `savedJourney`). This design has one snapshot.

Website Select enqueues the same `send_token_payment_link` work a `BOOK_TOKEN` tap enqueues (`lib/whatsapp/sendTokenPaymentLink.ts`). Website Pay uses that intent. Balance pay uses the existing balance-payment path. Token confirmation still finalizes through the existing webhook and `finalize_booking` path.

`DEMO_MODE` still uses the fixed OTP. Pay on the site completes through the existing demo payment path and the screen advances through the same steps. Mock WhatsApp chat is not the way the guest pays.

## Out of scope

- A trip list, or switching between several open trips.
- A long-lived login cookie that skips OTP on a new visit.
- Guest-facing vendor assign, driver assignment text, reminders, check-in, or review.
- A chat-shaped page.
- Tightening cancel-after-payment. The button stays until a later change.
- A browser Supabase Realtime subscription.

## Security

- The fuller trip read and the select, pay, and cancel writes require the tab session that owns the trip, or an OTP just completed for that phone.
- Negotiation floors and vendor rate-band fields stay server-side, as they do on `GET /api/trip-requests/[id]` today.
- Cancel and pay actions are idempotent. Repeating them does not create a second payment or a second booking.
- A payment webhook for a closed trip does not resume that trip.

## Testing

- Start a trip, accept the code, and see the quotes page while the quote template is sent.
- Select on the site, then see the lock page, and see the lock message on WhatsApp.
- Select on WhatsApp, refresh the site, and see the lock page with the other operators gone.
- Pay ₹99 on the site and on the WhatsApp link. Both use one payment. After confirmation the site shows token received.
- Leave checkout and pay again. The same payment is reused.
- Confirm a payment that Cashfree already marks paid. A second checkout does not open.
- Assign a driver and see the balance page without a phone number. Pay the balance and see the phone, Call, and WhatsApp.
- Open the same phone in a second tab after OTP and see the same step.
- Refresh the same tab and stay on the step without OTP.
- Close the tab, open the site, enter the phone and code, and land on the current step.
- Start a new request for a phone that already has a trip in progress and land on that trip.
- Cancel after payment, land on home, start another trip on the same phone, and confirm a late webhook does not revive the closed trip.
