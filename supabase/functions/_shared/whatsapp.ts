const GRAPH_API_VERSION = "v20.0";

export interface WhatsAppButton {
  /** Button payload, e.g. `BOOK_FULL::<quote_snapshot_id>` (Plan §7.2) */
  id: string;
  /** WhatsApp Cloud API caps quick-reply button titles at 20 characters. */
  title: string;
}

export interface SendWhatsAppResult {
  configured: boolean;
  success: boolean;
  waMessageId?: string;
  error?: string;
}

/**
 * Sends an interactive quick-reply button message via the WhatsApp Cloud
 * API. Mirrors the fetch shape in lib/whatsapp/sendAuthTemplateOtp.ts (Next
 * app), duplicated here rather than imported because Edge Functions run in
 * Deno and deploy independently of the Next.js app — that file also imports
 * the `server-only` package, which doesn't resolve outside Next.js.
 *
 * Buttons are capped at 3 per Meta's constraint (Plan §6.1 footnote) —
 * callers are responsible for keeping `buttons.length <= 3`.
 */
export async function sendWhatsAppButtonMessage(
  phoneE164: string,
  bodyText: string,
  buttons: WhatsAppButton[],
): Promise<SendWhatsAppResult> {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  if (!accessToken || !phoneNumberId) {
    return { configured: false, success: false, error: "WhatsApp Cloud API credentials are not configured" };
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
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: bodyText },
          action: {
            buttons: buttons.map((button) => ({
              type: "reply",
              reply: { id: button.id, title: button.title },
            })),
          },
        },
      }),
    });

    const responseBody = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        configured: true,
        success: false,
        error: `WhatsApp API returned ${response.status}: ${JSON.stringify(responseBody)}`,
      };
    }

    const waMessageId = responseBody?.messages?.[0]?.id as string | undefined;
    return { configured: true, success: true, waMessageId };
  } catch (error) {
    return {
      configured: true,
      success: false,
      error: error instanceof Error ? error.message : "Unknown WhatsApp send error",
    };
  }
}

/**
 * SMS fallback stub — no SMS provider has been chosen yet, mirroring the
 * documented gap in lib/sms/sendOtpSms.ts. Reports `configured: false`
 * rather than faking success, so callers correctly treat this as a failed
 * channel and let the job retry/backoff (Checklist 3.10) instead of
 * silently dropping the notification.
 */
export async function sendSmsFallback(): Promise<SendWhatsAppResult> {
  return { configured: false, success: false, error: "No SMS provider is configured yet" };
}
