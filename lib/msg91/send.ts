import "server-only";

import { sendMsg91TemplateWithConfig } from "./pure";
import type { Msg91SendResult, SendMsg91TemplateInput } from "./types";

/**
 * Next.js MSG91 template send. Phase 2 OTP uses this from
 * `lib/whatsapp/sendAuthTemplateOtp.ts`. Edge live send stays Graph until Phase 3.
 */
export async function sendMsg91TemplateMessage(
  input: SendMsg91TemplateInput,
): Promise<Msg91SendResult> {
  return sendMsg91TemplateWithConfig(input, {
    authKey: process.env.MSG91_AUTH_KEY,
    integratedNumber: process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER,
  });
}
