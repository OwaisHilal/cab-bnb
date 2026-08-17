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
