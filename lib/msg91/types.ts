/**
 * Same result contract as SendWhatsAppResult in
 * supabase/functions/_shared/whatsapp.ts. Phase 2–3 call sites must keep
 * these field names so handlers and the OTP route do not change.
 */
export interface Msg91SendResult {
  configured: boolean;
  success: boolean;
  waMessageId?: string;
  error?: string;
}

/**
 * MSG91 template component value (docs.msg91.com/whatsapp/template-bulk
 * and msg91.com/help/whatsapp/whatsapp-otp). Keys on the parent object are
 * `body_1`, `button_1`, `header_1`, … — not Meta's `components[]` array.
 */
export interface Msg91TemplateComponent {
  type: string;
  value: string;
  subtype?: string;
}

export interface SendMsg91TemplateInput {
  toE164: string;
  templateName: string;
  languageCode: string;
  /** Required by MSG91 for many templates; omit rather than invent. */
  namespace?: string;
  components?: Record<string, Msg91TemplateComponent>;
  /** Optional correlation id returned on MSG91 Webhook (New). */
  crqid?: string;
}

export interface Msg91SendCredentials {
  authKey: string;
  integratedNumber: string;
}

export interface Msg91OtpTemplateConfig {
  templateName: string;
  languageCode: string;
  namespace?: string;
}

export interface Msg91WhatsAppButton {
  id: string;
  title: string;
}

export interface Msg91WhatsAppListRow {
  id: string;
  title: string;
  description?: string;
}

export interface Msg91WhatsAppListSection {
  title: string;
  rows: Msg91WhatsAppListRow[];
}

export interface SendMsg91InteractiveInput {
  toE164: string;
  bodyText: string;
  buttons: Msg91WhatsAppButton[];
  footerText?: string;
}

export interface SendMsg91CtaUrlInput {
  toE164: string;
  bodyText: string;
  buttonTitle: string;
  url: string;
  footerText?: string;
}

export interface SendMsg91InteractiveListInput {
  toE164: string;
  bodyText: string;
  buttonText: string;
  sections: Msg91WhatsAppListSection[];
  headerText?: string;
  footerText?: string;
}

export interface SendMsg91TextInput {
  toE164: string;
  bodyText: string;
}

export interface SendMsg91ImageInput {
  toE164: string;
  imageUrl: string;
  caption: string;
}

/** MSG91 WhatsApp Payments cart line (Cashfree). Item name max 60 chars. */
export interface Msg91PaymentLinkItem {
  name: string;
  amount: number;
  quantity: number;
}

/**
 * Session interactive `type: "payment_link"` (docs.msg91.com WhatsApp Payments).
 * Must be sent inside the 24h customer-care window. Cashfree only.
 */
export interface SendMsg91PaymentLinkInput {
  toE164: string;
  bodyText: string;
  footerText?: string;
  headerImageUrl?: string;
  items: Msg91PaymentLinkItem[];
  crqid?: string;
}
