import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { AdminDebugWhatsAppFeed } from "@/features/admin-debug/types"
import { isDemoMode } from "@/lib/otp/demoMode"
import { getWhatsAppOutboundProvider, isWhatsAppOutboundConfigured } from "@/lib/whatsapp/sendCloudMessage"

interface MessageRow {
  id: string
  trip_request_id: string | null
  direction: string
  body_snapshot: string | null
  button_payload: string | null
  template_name: string | null
  wa_message_id: string | null
  wa_status: string | null
  created_at: string
}

const WHATSAPP_DEBUG_JOB_TYPES = ["send_quotes", "send_token_payment_link"] as const

interface JobRow {
  id: string
  job_type: string
  payload: { trip_request_id?: string; quote_snapshot_id?: string }
  status: string
  attempts: number
  last_error: string | null
  created_at: string
}

export async function loadWhatsAppDebugFeed(supabase: SupabaseClient): Promise<AdminDebugWhatsAppFeed> {
  const [messagesResult, jobsResult] = await Promise.all([
    supabase
      .from("whatsapp_message_log")
      .select(
        "id, trip_request_id, direction, body_snapshot, button_payload, template_name, wa_message_id, wa_status, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("job_queue")
      .select("id, job_type, payload, status, attempts, last_error, created_at")
      .in("job_type", WHATSAPP_DEBUG_JOB_TYPES)
      .in("status", ["queued", "processing", "failed"])
      .order("created_at", { ascending: false })
      .limit(20),
  ])

  if (messagesResult.error) {
    throw new Error(`Failed to fetch WhatsApp message log: ${messagesResult.error.message}`)
  }
  if (jobsResult.error) {
    throw new Error(`Failed to fetch job queue: ${jobsResult.error.message}`)
  }

  return {
    whatsapp_configured: isWhatsAppOutboundConfigured(),
    whatsapp_provider: getWhatsAppOutboundProvider(),
    demo_mode: isDemoMode(),
    simulate_when_unconfigured: isDemoMode(),
    messages: ((messagesResult.data ?? []) as MessageRow[]).map((row) => ({
      id: row.id,
      trip_request_id: row.trip_request_id,
      direction: row.direction as "outbound" | "inbound",
      body_snapshot: row.body_snapshot,
      button_payload: row.button_payload,
      template_name: row.template_name,
      wa_message_id: row.wa_message_id,
      wa_status: row.wa_status,
      created_at: row.created_at,
    })),
    pending_jobs: ((jobsResult.data ?? []) as JobRow[]).map((row) => ({
      id: row.id,
      trip_request_id: row.payload?.trip_request_id ?? null,
      quote_snapshot_id: row.payload?.quote_snapshot_id ?? null,
      job_type: row.job_type,
      status: row.status,
      attempts: row.attempts,
      last_error: row.last_error,
      created_at: row.created_at,
    })),
  }
}
