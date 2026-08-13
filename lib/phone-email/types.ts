/**
 * Phone.Email's public docs (https://www.phone.email/docs-sign-in-with-phone)
 * describe more than one frontend integration shape. `access_token` is the
 * flow that matches the CLIENT_ID + API Key credentials this project has
 * (Plan §2 audit): the frontend opens Phone.Email's auth popup and gets back
 * an `access_token`, which the backend exchanges via
 * `eapi.phone.email/getuser` and validates (`ph_email_jwt`) with the API
 * key. `user_json_url` (generated-button flow) is kept for backwards
 * compatibility. `user_info` (React `phone-email-auth` component) remains an
 * unconfirmed contract and is not implemented.
 */
export type PhoneEmailVerificationPayload =
  | { mode: "access_token"; access_token: string }
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
