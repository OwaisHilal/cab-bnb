export interface MockMessagingButton {
  id: string
  title: string
}

export interface MockMessagingMessage {
  id: string
  direction: "outbound" | "inbound"
  body_snapshot: string | null
  button_payload: string | null
  buttons: MockMessagingButton[]
  ctaUrl?: { title: string; url: string } | null
  media: MockChatMedia | null
  template_name: string | null
  wa_status: string | null
  created_at: string
  vendor_id: string | null
  booking_id: string | null
  audience?: "customer" | "vendor" | "driver"
  message_kind?: "text" | "button" | "list"
  flow_step_id?: string | null
  recipient_hint?: string | null
}

export interface MockChatMedia {
  carImageUrl: string
  driverImageUrl: string
}

export interface MockMessagingThread {
  trip_request_id: string
  tourist_phone: string | null
  messages: MockMessagingMessage[]
}
