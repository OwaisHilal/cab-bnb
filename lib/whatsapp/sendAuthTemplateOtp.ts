import "server-only";

const GRAPH_API_VERSION = "v20.0";
const DEFAULT_TEMPLATE_NAME = "otp_verification";

export interface SendOtpChannelResult {
  configured: boolean;
  success: boolean;
  error?: string;
}

/**
 * Meta WhatsApp Cloud API authentication-template send (Checklist 2.3,
 * Plan §5 step 4). Returns a result object instead of throwing on missing
 * config, so app/api/otp/send/route.ts can fall through to SMS instead of
 * hard-failing the request.
 *
 * Documented assumption: the exact `components` shape for Meta's
 * "copy code" / "one-tap autofill" authentication templates depends on how
 * the template is configured in the Meta portal (whether the code also
 * needs a button parameter). This sends the baseline body-only parameter
 * shape — revisit once a real approved template exists in production.
 */
export async function sendWhatsAppOtp(phoneE164: string, code: string): Promise<SendOtpChannelResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME || DEFAULT_TEMPLATE_NAME;

  if (!accessToken || !phoneNumberId) {
    return {
      configured: false,
      success: false,
      error: "WhatsApp Cloud API credentials are not configured",
    };
  }

  try {
    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phoneE164.replace(/^\+/, ""),
        type: "template",
        template: {
          name: templateName,
          language: { code: "en_US" },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: code }],
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        configured: true,
        success: false,
        error: `WhatsApp API returned ${response.status}: ${errorBody}`,
      };
    }

    return { configured: true, success: true };
  } catch (error) {
    return {
      configured: true,
      success: false,
      error: error instanceof Error ? error.message : "Unknown WhatsApp send error",
    };
  }
}
