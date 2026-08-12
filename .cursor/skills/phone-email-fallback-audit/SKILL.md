---
name: phone-email-fallback-audit
description: >-
  Audits the Phone.Email OTP fallback feature for Kashmir BnB Cabs to
  determine exactly what remains before it's finish-ready, and resumes work
  from where it was left off. Use when the user asks to finish, resume, wire
  up, or audit the Phone.Email fallback, PhoneEmailAdapter, or backup OTP
  verification.
disable-model-invocation: true
---

# Phone.Email Fallback Audit

## Context

WhatsApp OTP is primary (Plan §5, Checklist 2.3/2.4). Phone.Email
(https://www.phone.email/docs-sign-in-with-phone) is the fallback used only
when both WhatsApp and SMS delivery fail. The shared backend/security
architecture and UI scaffolding are complete; only the provider-specific
frontend widget wiring was deliberately deferred pending TL-supplied
dashboard configuration (`CLIENT_ID` + integration shape).

Original implementation plan (if still present):
`phone.email_otp_fallback_a2587d83.plan.md` in the user's `.cursor/plans/`
folder. Treat this file as the condensed, durable spec if that plan is gone
or stale.

## What's already done — do not re-implement

| Area | File | Status |
|---|---|---|
| Shared verification completion | `lib/otp/completePhoneVerification.ts` | Done — session/trip_request binding check, tourist upsert, duplicate-`send_quotes`-job guard |
| OTP-code verify route | `app/api/otp/verify/route.ts` | Done — calls the shared helper before marking the OTP row verified |
| Provider-neutral contract | `lib/phone-email/types.ts` | Done — `PhoneEmailVerificationPayload` discriminated union |
| `user_json_url` verification | `lib/phone-email/verifyPhoneEmailProof.ts` | Done — https-only, host-allowlisted (`PHONE_EMAIL_USER_JSON_ALLOWED_HOST`), no credentials in URL, `AbortController` timeout, no-redirect fetch |
| `user_info` verification | `lib/phone-email/verifyPhoneEmailProof.ts` | **Stub** — deliberate `501`, needs the TL's confirmed contract |
| Phone.Email verify route | `app/api/otp/phone-email/verify/route.ts` | Done |
| OTP send fallback signal | `app/api/otp/send/route.ts` | Done — returns `{ sent:false, fallback:"phone_email" }` (HTTP 200) when both channels fail |
| Env placeholders | `.env.example`, `.env.local` | Scaffolded, real values still empty |
| OTP types/UI | `features/whatsapp-otp/types.ts`, `WhatsAppOtpSheet.tsx` | Done — `phone_email` step, channel-aware code-entry copy |
| Adapter shell | `features/phone-email/components/PhoneEmailAdapter.tsx` | **Stub** — always renders the "being configured" placeholder; never loads a real widget/SDK |
| Booking flow wiring | `features/booking-request/hooks/useBookingFlow.ts` | Done — real `POST /api/trip-requests`, `/api/otp/send`, `/api/otp/verify`, `/api/otp/phone-email/verify` calls |

## What's NOT done — the actual remaining work

1. **Get from TL:** Phone.Email dashboard `CLIENT_ID`, and which integration
   shape is being used — `generated_button` or `react_client`.
2. **Wire the real widget in `PhoneEmailAdapter.tsx`** (the only file
   allowed to know provider SDK details):
   - `generated_button` → embed the TL's generated script/button; in its
     callback, call `onVerified({ mode: "user_json_url", user_json_url })`.
   - `react_client` → `npm i phone-email-auth`; render
     `<PhoneEmailLogin clientId={...} />`; on success call
     `userInfo(CLIENT_ID)`; call
     `onVerified({ mode: "user_info", user_info })`.
3. **If `react_client` is chosen**, implement `verifyViaUserInfo` in
   `lib/phone-email/verifyPhoneEmailProof.ts` (currently `501`) once the TL
   confirms the exact response contract — don't assume the public docs'
   `getuser` fields (`country_code`, `phone_no`, `ph_email_jwt`) without
   confirming against what the TL's dashboard actually returns.
4. **Fill real values** into `.env.local` (never commit secrets):
   `NEXT_PUBLIC_PHONE_EMAIL_CLIENT_ID`, `NEXT_PUBLIC_PHONE_EMAIL_PROVIDER_MODE=true`/`generated_button`/`react_client` as applicable.
5. **Manual end-to-end test** of the full fallback path (see Verification).

## Audit workflow

```
Audit progress:
- [ ] Check .env.local: is NEXT_PUBLIC_PHONE_EMAIL_CLIENT_ID / PROVIDER_MODE set?
- [ ] Read PhoneEmailAdapter.tsx: still the stub, or real widget code added?
- [ ] Read verifyPhoneEmailProof.ts: is verifyViaUserInfo still a 501?
- [ ] Grep features/phone-email/** and lib/phone-email/** for TODO/stub markers
- [ ] Report which of the 5 "remaining work" items above are done vs still open
```

Never mark an item done without reading the actual file.

## Security invariants — do not relax when finishing this

- Never trust a phone number reported directly by the browser; the frontend
  only ever forwards provider proof (`user_json_url` or `user_info`) —
  `completePhoneVerification` only accepts a `phoneE164` the backend itself
  derived from that proof.
- Keep the `user_json_url` fetch https-only, host-allowlisted, credential-free
  in the URL, and time-bounded via `AbortController` — do not loosen these
  when wiring the real generated-button flow.
- Don't implement `verifyViaUserInfo` by trusting the client's `userInfo`
  object as-is; verify server-side against Phone.Email's own endpoint per
  the TL-confirmed contract, the same way `user_json_url` mode does.
- Never put a Phone.Email secret in a `NEXT_PUBLIC_*` var — only `CLIENT_ID`
  and provider mode belong there.
- Do not add a manual `user_json_url` input to production UI — explicitly
  rejected earlier in this feature's design.
- Preserve the session-binding check (`trip_requests.session_id === sessionId`)
  in `completePhoneVerification` for both verification paths.

## Verification

- `npm run lint`, `npx tsc --noEmit -p tsconfig.json`, `npm run build` must
  stay clean (use `cmd /c "..."` on this Windows/PowerShell environment to
  avoid the PowerShell execution-policy wrapper failing the command).
- Manual: force a WhatsApp/SMS failure → confirm the Phone.Email step now
  renders the real widget (not the placeholder) → complete it → confirm the
  trip_request links and a `send_quotes` job is enqueued.

## Related skills

- **kashmirbnb-spec-audit** — full Kashmir BnB spec audit
- **kashmirbnb-build** — general phase build order
- **verification-before-completion** — required before claiming this done
