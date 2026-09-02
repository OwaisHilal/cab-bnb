import {
  resolveMsg91SendCredentials,
  sendMsg91ImageWithConfig,
  sendMsg91InteractiveButtonWithConfig,
  sendMsg91InteractiveListWithConfig,
  sendMsg91TextWithConfig,
  type Msg91WhatsAppButton,
  type Msg91WhatsAppListSection,
} from "./msg91WhatsApp.ts";

const GRAPH_API_VERSION = "v20.0";

export interface WhatsAppButton {
  /** Button payload, e.g. `BOOK_TOKEN::<quote_snapshot_id>` (Plan §7.2) */
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

function readMsg91Credentials() {
  return resolveMsg91SendCredentials({
    MSG91_AUTH_KEY: Deno.env.get("MSG91_AUTH_KEY") ?? undefined,
    MSG91_WHATSAPP_INTEGRATED_NUMBER: Deno.env.get("MSG91_WHATSAPP_INTEGRATED_NUMBER") ?? undefined,
  });
}

function getMetaWhatsAppCredentials(): { accessToken: string; phoneNumberId: string } | null {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN")?.trim();
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")?.trim();
  if (!accessToken || !phoneNumberId) return null;
  return { accessToken, phoneNumberId };
}

/**
 * Shared Graph API POST + response handling for Meta fallback sends.
 */
async function postWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  messageBody: Record<string, unknown>,
): Promise<SendWhatsAppResult> {
  try {
    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messageBody),
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
 * Sends an interactive quick-reply button message.
 * Prefers MSG91 when MSG91_AUTH_KEY + MSG91_WHATSAPP_INTEGRATED_NUMBER are set;
 * falls back to Meta Graph when WHATSAPP_* credentials are present.
 */
export async function sendWhatsAppButtonMessage(
  phoneE164: string,
  bodyText: string,
  buttons: WhatsAppButton[],
): Promise<SendWhatsAppResult> {
  const msg91 = readMsg91Credentials();
  if (msg91) {
    return sendMsg91InteractiveButtonWithConfig(
      {
        toE164: phoneE164,
        bodyText,
        buttons: buttons as Msg91WhatsAppButton[],
      },
      msg91,
    );
  }

  const credentials = getMetaWhatsAppCredentials();
  if (!credentials) {
    return { configured: false, success: false, error: "WhatsApp outbound credentials are not configured" };
  }

  return postWhatsAppMessage(credentials.phoneNumberId, credentials.accessToken, {
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
  });
}

export async function sendWhatsAppListMessage(
  phoneE164: string,
  bodyText: string,
  list: { buttonText: string; sections: Msg91WhatsAppListSection[] },
): Promise<SendWhatsAppResult> {
  const msg91 = readMsg91Credentials();
  if (msg91) {
    return sendMsg91InteractiveListWithConfig(
      {
        toE164: phoneE164,
        bodyText,
        buttonText: list.buttonText,
        sections: list.sections,
      },
      msg91,
    );
  }

  const credentials = getMetaWhatsAppCredentials();
  if (!credentials) {
    return { configured: false, success: false, error: "WhatsApp outbound credentials are not configured" };
  }

  return postWhatsAppMessage(credentials.phoneNumberId, credentials.accessToken, {
    messaging_product: "whatsapp",
    to: phoneE164.replace(/^\+/, ""),
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: {
        button: list.buttonText,
        sections: list.sections.map((section) => ({
          title: section.title,
          rows: section.rows.map((row) => ({
            id: row.id,
            title: row.title,
            ...(row.description ? { description: row.description } : {}),
          })),
        })),
      },
    },
  });
}

/**
 * Sends a plain text WhatsApp message — vendor notification, reminders, etc.
 */
export async function sendWhatsAppTextMessage(
  phoneE164: string,
  bodyText: string,
): Promise<SendWhatsAppResult> {
  const msg91 = readMsg91Credentials();
  if (msg91) {
    return sendMsg91TextWithConfig({ toE164: phoneE164, bodyText }, msg91);
  }

  const credentials = getMetaWhatsAppCredentials();
  if (!credentials) {
    return { configured: false, success: false, error: "WhatsApp outbound credentials are not configured" };
  }

  return postWhatsAppMessage(credentials.phoneNumberId, credentials.accessToken, {
    messaging_product: "whatsapp",
    to: phoneE164.replace(/^\+/, ""),
    type: "text",
    text: { body: bodyText },
  });
}

/**
 * Sends a WhatsApp image message with a caption.
 */
export async function sendWhatsAppImageMessage(
  phoneE164: string,
  imageUrl: string,
  caption: string,
): Promise<SendWhatsAppResult> {
  const msg91 = readMsg91Credentials();
  if (msg91) {
    return sendMsg91ImageWithConfig({ toE164: phoneE164, imageUrl, caption }, msg91);
  }

  const credentials = getMetaWhatsAppCredentials();
  if (!credentials) {
    return { configured: false, success: false, error: "WhatsApp outbound credentials are not configured" };
  }

  return postWhatsAppMessage(credentials.phoneNumberId, credentials.accessToken, {
    messaging_product: "whatsapp",
    to: phoneE164.replace(/^\+/, ""),
    type: "image",
    image: { link: imageUrl, caption },
  });
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
