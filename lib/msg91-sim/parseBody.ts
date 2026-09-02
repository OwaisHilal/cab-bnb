import { asRecord, readString, stripPhone } from "./ids"

export type BulkRecipient = {
  to: string[]
  components: Record<string, unknown>
  crqid?: string
}

export type ParsedBulk = {
  integratedNumber: string
  templateName: string
  languageCode: string
  namespace?: string
  crqid?: string
  recipients: BulkRecipient[]
  raw: Record<string, unknown>
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string }

export function parseBulkBody(body: unknown): ParseResult<ParsedBulk> {
  const root = asRecord(body)
  if (!root) {
    return { ok: false, message: "Request body must be a JSON object" }
  }

  const integratedNumber = readString(root, ["integrated_number", "integratedNumber"])
  const contentType = readString(root, ["content_type", "contentType"])
  if (!integratedNumber) {
    return { ok: false, message: "integrated_number is required" }
  }
  if (contentType && contentType !== "template") {
    return { ok: false, message: 'content_type must be "template"' }
  }

  const payload = asRecord(root.payload) ?? root
  const template = asRecord(payload.template)
  if (!template) {
    return { ok: false, message: "payload.template is required" }
  }

  const templateName = readString(template, ["name", "template_name"])
  const language = asRecord(template.language)
  const languageCode =
    (language ? readString(language, ["code"]) : undefined) ??
    (typeof template.language === "string" ? template.language : undefined)
  if (!templateName) {
    return { ok: false, message: "template.name is required" }
  }
  if (!languageCode) {
    return { ok: false, message: "template.language.code is required" }
  }

  const toAndComponents = template.to_and_components
  if (!Array.isArray(toAndComponents) || toAndComponents.length === 0) {
    return { ok: false, message: "template.to_and_components is required" }
  }

  const recipients: BulkRecipient[] = []
  for (const entry of toAndComponents) {
    const row = asRecord(entry)
    if (!row) {
      return { ok: false, message: "to_and_components entries must be objects" }
    }
    const toRaw = row.to
    const toList = Array.isArray(toRaw)
      ? toRaw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : typeof toRaw === "string"
        ? [toRaw]
        : []
    if (toList.length === 0) {
      return { ok: false, message: "to_and_components[].to is required" }
    }
    const components = asRecord(row.components) ?? {}
    const crqid = readString(row, ["CRQID", "crqid"])
    recipients.push({
      to: toList.map(stripPhone),
      components,
      ...(crqid ? { crqid } : {}),
    })
  }

  const namespace = readString(template, ["namespace"])
  const crqid = readString(root, ["CRQID", "crqid"])

  return {
    ok: true,
    value: {
      integratedNumber: stripPhone(integratedNumber),
      templateName,
      languageCode,
      ...(namespace ? { namespace } : {}),
      ...(crqid ? { crqid } : {}),
      recipients,
      raw: root,
    },
  }
}

export type ParsedSession =
  | {
      kind: "interactive"
      integratedNumber: string
      recipientNumber: string
      interactive: Record<string, unknown>
      raw: Record<string, unknown>
    }
  | {
      kind: "text"
      integratedNumber: string
      recipientNumber: string
      text: string
      raw: Record<string, unknown>
    }
  | {
      kind: "image"
      integratedNumber: string
      recipientNumber: string
      image: { link: string; caption?: string }
      raw: Record<string, unknown>
    }

export function parseSessionRequest(
  body: unknown,
  searchParams: URLSearchParams,
): ParseResult<ParsedSession> {
  const root = asRecord(body) ?? {}
  const queryType = searchParams.get("content_type")?.trim()
  const queryText = searchParams.get("text")
  const queryIntegrated = searchParams.get("integrated_number")
  const queryRecipient = searchParams.get("recipient_number")

  if (queryType === "text" || (queryText && queryText.length > 0 && !asRecord(root.interactive))) {
    const integratedNumber = queryIntegrated ?? readString(root, ["integrated_number", "from"])
    const recipientNumber = queryRecipient ?? readString(root, ["recipient_number", "to"])
    const text = queryText ?? readString(root, ["text"])
    if (!integratedNumber || !recipientNumber || !text) {
      return {
        ok: false,
        message: "integrated_number, recipient_number, and text are required for text messages",
      }
    }
    return {
      ok: true,
      value: {
        kind: "text",
        integratedNumber: stripPhone(integratedNumber),
        recipientNumber: stripPhone(recipientNumber),
        text,
        raw: { ...root, content_type: "text" },
      },
    }
  }

  const message = asRecord(root.message)
  const image = message ? asRecord(message.image) : asRecord(root.image)
  if (image || readString(root, ["to_whatsapp_id"])) {
    const recipientNumber =
      readString(root, ["to_whatsapp_id", "recipient_number", "to"]) ?? queryRecipient
    const integratedNumber =
      readString(root, ["from_whatsapp_id", "integrated_number", "from"]) ?? queryIntegrated
    const link = image ? readString(image, ["link", "url"]) : undefined
    if (!recipientNumber || !integratedNumber || !link) {
      return {
        ok: false,
        message: "to_whatsapp_id, from_whatsapp_id, and message.image.link are required",
      }
    }
    const caption = image ? readString(image, ["caption"]) : undefined
    return {
      ok: true,
      value: {
        kind: "image",
        integratedNumber: stripPhone(integratedNumber),
        recipientNumber: stripPhone(recipientNumber),
        image: { link, ...(caption ? { caption } : {}) },
        raw: root,
      },
    }
  }

  const interactive = asRecord(root.interactive)
  const type = readString(root, ["type", "content_type"]) ?? queryType
  if (interactive && (type === "interactive" || type === undefined || root.content_type === "interactive")) {
    const recipientNumber =
      readString(root, ["recipient_number", "to"]) ?? queryRecipient
    const integratedNumber =
      readString(root, ["integrated_number", "from"]) ?? queryIntegrated
    if (!recipientNumber || !integratedNumber) {
      return {
        ok: false,
        message: "recipient_number (or to) and integrated_number (or from) are required",
      }
    }
    return {
      ok: true,
      value: {
        kind: "interactive",
        integratedNumber: stripPhone(integratedNumber),
        recipientNumber: stripPhone(recipientNumber),
        interactive,
        raw: root,
      },
    }
  }

  return { ok: false, message: "Unsupported outbound payload: expected interactive, text, or image" }
}

export type ExtractedTemplateFields = {
  name?: string
  language?: string
  category?: string
  namespace?: string
  integratedNumber?: string
  components: Record<string, unknown>
}

export function extractTemplateFields(body: unknown): ExtractedTemplateFields {
  const root = asRecord(body) ?? {}
  const nestedTemplate = asRecord(root.template)
  const languageObj = asRecord(root.language) ?? (nestedTemplate ? asRecord(nestedTemplate.language) : null)
  const rawComponents = root.components ?? (nestedTemplate ? nestedTemplate.components : undefined)
  const components = Array.isArray(rawComponents)
    ? { facebook_components: rawComponents }
    : asRecord(rawComponents) ?? {}

  return {
    name: readString(root, ["template_name", "name", "templateName"]) ??
      (nestedTemplate ? readString(nestedTemplate, ["name", "template_name"]) : undefined),
    language:
      (languageObj ? readString(languageObj, ["code"]) : undefined) ??
      readString(root, ["language", "language_code", "template_language"]) ??
      (nestedTemplate && typeof nestedTemplate.language === "string"
        ? nestedTemplate.language
        : undefined),
    category: readString(root, ["category"]),
    namespace: readString(root, ["namespace"]) ??
      (nestedTemplate ? readString(nestedTemplate, ["namespace"]) : undefined),
    integratedNumber: readString(root, ["integrated_number", "integratedNumber"]),
    components,
  }
}

export function parseJsonBody(raw: unknown): Record<string, unknown> {
  return asRecord(raw) ?? {}
}

export function parseDeleteTemplateQuery(
  searchParams: URLSearchParams,
): ParseResult<{ templateName: string; integratedNumber: string }> {
  const templateName = searchParams.get("template_name")?.trim()
  const integratedNumber = searchParams.get("integrated_number")?.trim()
  if (!templateName || !integratedNumber) {
    return { ok: false, message: "template_name and integrated_number are required" }
  }
  return {
    ok: true,
    value: { templateName, integratedNumber: stripPhone(integratedNumber) },
  }
}
