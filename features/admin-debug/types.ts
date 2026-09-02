export interface AdminDebugQuote {
  id: string
  vendor_name: string
  current_quote: number
  is_best_price: boolean
  status: string
}

export interface AdminDebugTripRequest {
  id: string
  session_id: string
  status: string
  trip_start_date: string
  trip_days: number
  pax_count: number
  tourist_phone: string | null
  tourist_name: string | null
  requested_vehicle_type_label: string | null
  recommendation_reason: string | null
  quote_count: number
  best_quote: number | null
  created_at: string
  updated_at: string
  quotes: AdminDebugQuote[]
}

export interface AdminDebugBooking {
  id: string
  booking_ref: string
  status: string
  payment_status: string
  final_quote: number | null
  tourist_phone: string | null
  vendor_name: string | null
  vehicle_type_label: string | null
  trip_days: number
  pax_count: number
  created_at: string
}

export interface AdminDebugFeed {
  fetched_at: string
  trip_requests: AdminDebugTripRequest[]
  bookings: AdminDebugBooking[]
  whatsapp: AdminDebugWhatsAppFeed
}

export interface AdminDebugWhatsAppMessage {
  id: string
  trip_request_id: string | null
  direction: "outbound" | "inbound"
  body_snapshot: string | null
  button_payload: string | null
  template_name: string | null
  wa_message_id: string | null
  wa_status: string | null
  created_at: string
}

export interface AdminDebugWhatsAppJob {
  id: string
  trip_request_id: string | null
  job_type: string
  status: string
  attempts: number
  last_error: string | null
  created_at: string
}

export interface AdminDebugWhatsAppFeed {
  whatsapp_configured: boolean
  whatsapp_provider: "msg91" | "meta" | null
  demo_mode: boolean
  simulate_when_unconfigured: boolean
  messages: AdminDebugWhatsAppMessage[]
  pending_jobs: AdminDebugWhatsAppJob[]
}

export interface AdminDebugWhatsAppPreview {
  trip_request_id: string
  tourist_phone: string
  body_text: string
  buttons: { id: string; title: string }[]
  pending_snapshot_count: number
}

export interface AdminDebugWhatsAppSendResult {
  channel: "whatsapp" | "demo_simulated"
  simulated: boolean
  wa_message_id: string | null
  tourist_phone: string
  body_text: string
}

