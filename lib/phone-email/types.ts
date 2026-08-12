/**
 * Phone.Email's public docs (https://www.phone.email/docs-sign-in-with-phone)
 * describe at least two distinct frontend integration shapes: a
 * generated-button flow that hands back a `user_json_url` for the backend
 * to fetch, and a React `phone-email-auth` component that hands back a
 * `userInfo`-style payload directly. The TL has not yet supplied the exact
 * dashboard configuration for either, so this contract stays a discriminated
 * union rather than committing to one shape — see Plan §3.
 */
export type PhoneEmailVerificationPayload =
  | { mode: "user_json_url"; user_json_url: string }
  | { mode: "user_info"; user_info: unknown };

export interface VerifiedPhoneEmailUser {
  phoneE164: string;
  firstName?: string;
  lastName?: string;
}

export type VerifyPhoneEmailProofResult =
  | { ok: true; user: VerifiedPhoneEmailUser }
  | { ok: false; status: number; message: string };
