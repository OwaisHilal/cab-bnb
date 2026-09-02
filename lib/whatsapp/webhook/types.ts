export type InboundInteractionType = "button_click" | "list_reply" | "free_text";

export interface InboundWhatsAppMessage {
  waMessageId: string;
  fromPhone: string;
  timestamp: string;
  type: string;
  textBody: string | null;
  buttonPayload: string | null;
  interactionType: InboundInteractionType | null;
}

export type ParsedActionType =
  | "book_full"
  | "book_token"
  | "negotiate"
  | "complete_payment"
  | "checkin_ok"
  | "checkin_help"
  | "rate"
  | "driver_details"
  | "unknown";

export interface ParsedDriverDetails {
  name: string;
  phone: string;
  vehicleNumber: string;
  vehicleModel: string;
}

export interface ParsedAction {
  type: ParsedActionType;
  quoteSnapshotId?: string;
  lifecycleEventId?: string;
  bookingId?: string;
  rating?: number;
  driverDetails?: ParsedDriverDetails;
}

/** Meta message delivery-status event (`entry[].changes[].value.statuses[]`). */
export interface InboundWhatsAppStatus {
  waMessageId: string;
  status: string;
  timestamp: string;
}
