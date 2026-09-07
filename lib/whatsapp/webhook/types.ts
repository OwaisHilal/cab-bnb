export type InboundInteractionType = "button_click" | "list_reply" | "free_text";

export interface InboundWhatsAppMessage {
  waMessageId: string;
  fromPhone: string;
  timestamp: string;
  type: string;
  textBody: string | null;
  buttonPayload: string | null;
  interactionType: InboundInteractionType | null;
  groupId?: string | null;
}

export type ParsedActionType =
  | "book_full"
  | "book_token"
  | "token_pay"
  | "negotiate"
  | "complete_payment"
  | "checkin_ok"
  | "checkin_help"
  | "rate"
  | "driver_details"
  | "unknown";

export interface ParsedDriverDetails {
  name?: string;
  phone: string;
  vehicleNumber?: string;
  vehicleModel?: string;
}

export interface ParsedAction {
  type: ParsedActionType;
  quoteSnapshotId?: string;
  lifecycleEventId?: string;
  bookingId?: string;
  rating?: number;
  driverDetails?: ParsedDriverDetails;
}

export interface InboundWhatsAppStatus {
  waMessageId: string;
  status: string;
  timestamp: string;
}

/** MSG91 Webhook (New) "On Payment Report Received" for WhatsApp Payments. */
export interface InboundWhatsAppPayment {
  crqid: string | null;
  customerNumber: string | null;
  paymentStatus: string;
  paid: boolean;
  waMessageId: string | null;
  timestamp: string;
  rawStatus: string;
}
