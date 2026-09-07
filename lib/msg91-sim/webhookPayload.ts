export type OutboundWebhookInput = {
  eventName: "sent" | "delivered" | "read" | "failed"
  customerNumber: string
  integratedNumber: string
  requestId: string
  uuid: string
  templateName?: string
  crqid?: string
  content: unknown
  requestedAt: string
  ts: string
}

export function buildOutboundWebhookPayload(input: OutboundWebhookInput): Record<string, unknown> {
  return {
    crqid: input.crqid ?? "",
    companyId: "sim",
    requestedAt: input.requestedAt,
    customerNumber: input.customerNumber,
    content: JSON.stringify(input.content ?? {}),
    requestId: input.requestId,
    reason: "",
    direction: "1",
    templateName: input.templateName ?? "",
    integratedNumber: input.integratedNumber,
    eventName: input.eventName,
    uuid: input.uuid,
    ts: input.ts,
    contentType: "template",
  }
}

export type InboundWebhookInput = {
  customerNumber: string
  integratedNumber: string
  uuid: string
  requestId: string
  text?: string
  button?: { payload: string; text: string }
  contentType: string
  ts: string
}

export type PaymentWebhookInput = {
  customerNumber: string
  integratedNumber: string
  uuid: string
  requestId: string
  crqid: string
  paymentStatus: string
  ts: string
}

export function buildPaymentWebhookPayload(input: PaymentWebhookInput): Record<string, unknown> {
  return {
    crqid: input.crqid,
    companyId: "sim",
    requestedAt: input.ts,
    customerNumber: input.customerNumber,
    content: JSON.stringify({ type: "payment_link" }),
    requestId: input.requestId,
    reason: "",
    direction: "1",
    templateName: "",
    integratedNumber: input.integratedNumber,
    eventName: "payment",
    webhookType: "payment",
    paymentStatus: input.paymentStatus,
    orders: JSON.stringify([{ status: input.paymentStatus, amount: 99 }]),
    uuid: input.uuid,
    ts: input.ts,
    contentType: "interactive",
  }
}

export function buildInboundWebhookPayload(input: InboundWebhookInput): Record<string, unknown> {
  const text = input.text ?? input.button?.text ?? ""
  const unix = String(Math.floor(Date.parse(input.ts) / 1000) || Math.floor(Date.now() / 1000))
  const interactive = input.button
    ? {
        type: "button_reply",
        button_reply: { id: input.button.payload, title: input.button.text },
      }
    : null
  const messages = [
    {
      from: input.customerNumber,
      id: input.uuid,
      timestamp: unix,
      type: input.button ? "interactive" : input.contentType,
      ...(input.button
        ? {
            button: { payload: input.button.payload, text: input.button.text },
            interactive,
          }
        : { text: { body: text } }),
    },
  ]

  return {
    crqid: "",
    companyId: "sim",
    requestedAt: input.ts,
    customerNumber: input.customerNumber,
    content: JSON.stringify(input.button ? { button: input.button } : { text }),
    requestId: input.requestId,
    reason: "",
    direction: "0",
    templateName: "",
    integratedNumber: input.integratedNumber,
    eventName: "inbound",
    uuid: input.uuid,
    ts: input.ts,
    text,
    contentType: input.contentType,
    button: input.button ? JSON.stringify(input.button) : "",
    interactive: interactive ? JSON.stringify(interactive) : "",
    messages: JSON.stringify(messages),
    contacts: JSON.stringify([{ profile: { name: "" }, wa_id: input.customerNumber }]),
  }
}
