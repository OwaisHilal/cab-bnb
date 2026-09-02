import "server-only"

import {
  isMsg91WhatsAppConfigured,
  sendMsg91ImageMessage,
  sendMsg91InteractiveButtonMessage,
  sendMsg91InteractiveListMessage,
  sendMsg91TextMessage,
} from "@/lib/msg91/sendSession"
import type {
  SendWhatsAppResult,
  WhatsAppButton,
  WhatsAppListMessage,
} from "@/lib/whatsapp/types"

const GRAPH_API_VERSION = "v20.0"

export type WhatsAppOutboundProvider = "msg91" | "meta"

function getMetaWhatsAppCredentials(): { accessToken: string; phoneNumberId: string } | null {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  if (!accessToken || !phoneNumberId) return null
  return { accessToken, phoneNumberId }
}

export function isWhatsAppCloudConfigured(): boolean {
  return getMetaWhatsAppCredentials() !== null
}

export function isWhatsAppOutboundConfigured(): boolean {
  return isMsg91WhatsAppConfigured() || isWhatsAppCloudConfigured()
}

export function getWhatsAppOutboundProvider(): WhatsAppOutboundProvider | null {
  if (isMsg91WhatsAppConfigured()) return "msg91"
  if (isWhatsAppCloudConfigured()) return "meta"
  return null
}

async function postMetaWhatsAppMessage(
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
    })

    const responseBody = await response.json().catch(() => null)

    if (!response.ok) {
      return {
        configured: true,
        success: false,
        error: `WhatsApp API returned ${response.status}: ${JSON.stringify(responseBody)}`,
      }
    }

    const waMessageId = responseBody?.messages?.[0]?.id as string | undefined
    return { configured: true, success: true, waMessageId }
  } catch (error) {
    return {
      configured: true,
      success: false,
      error: error instanceof Error ? error.message : "Unknown WhatsApp send error",
    }
  }
}

export async function sendWhatsAppButtonMessage(
  phoneE164: string,
  bodyText: string,
  buttons: WhatsAppButton[],
): Promise<SendWhatsAppResult> {
  if (isMsg91WhatsAppConfigured()) {
    return sendMsg91InteractiveButtonMessage({
      toE164: phoneE164,
      bodyText,
      buttons,
    })
  }

  const credentials = getMetaWhatsAppCredentials()
  if (!credentials) {
    return { configured: false, success: false, error: "WhatsApp outbound credentials are not configured" }
  }

  return postMetaWhatsAppMessage(credentials.phoneNumberId, credentials.accessToken, {
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
  })
}

export async function sendWhatsAppListMessage(
  phoneE164: string,
  bodyText: string,
  list: WhatsAppListMessage,
): Promise<SendWhatsAppResult> {
  if (isMsg91WhatsAppConfigured()) {
    return sendMsg91InteractiveListMessage({
      toE164: phoneE164,
      bodyText,
      buttonText: list.buttonText,
      sections: list.sections,
    })
  }

  const credentials = getMetaWhatsAppCredentials()
  if (!credentials) {
    return { configured: false, success: false, error: "WhatsApp outbound credentials are not configured" }
  }

  return postMetaWhatsAppMessage(credentials.phoneNumberId, credentials.accessToken, {
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
  })
}

export async function sendWhatsAppTextMessage(
  phoneE164: string,
  bodyText: string,
): Promise<SendWhatsAppResult> {
  if (isMsg91WhatsAppConfigured()) {
    return sendMsg91TextMessage({ toE164: phoneE164, bodyText })
  }

  const credentials = getMetaWhatsAppCredentials()
  if (!credentials) {
    return { configured: false, success: false, error: "WhatsApp outbound credentials are not configured" }
  }

  return postMetaWhatsAppMessage(credentials.phoneNumberId, credentials.accessToken, {
    messaging_product: "whatsapp",
    to: phoneE164.replace(/^\+/, ""),
    type: "text",
    text: { body: bodyText },
  })
}

export async function sendWhatsAppImageMessage(
  phoneE164: string,
  imageUrl: string,
  caption: string,
): Promise<SendWhatsAppResult> {
  if (isMsg91WhatsAppConfigured()) {
    return sendMsg91ImageMessage({ toE164: phoneE164, imageUrl, caption })
  }

  const credentials = getMetaWhatsAppCredentials()
  if (!credentials) {
    return { configured: false, success: false, error: "WhatsApp outbound credentials are not configured" }
  }

  return postMetaWhatsAppMessage(credentials.phoneNumberId, credentials.accessToken, {
    messaging_product: "whatsapp",
    to: phoneE164.replace(/^\+/, ""),
    type: "image",
    image: { link: imageUrl, caption },
  })
}
