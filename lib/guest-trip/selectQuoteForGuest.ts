import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { drainDueJobs } from "@/lib/jobs/drainDueJobs"
import { loadGuestTrip, sessionCanReadTrip } from "@/lib/guest-trip/loadGuestTrip"
import type { GuestTripSnapshot } from "@/lib/guest-trip/types"

const TOKEN_JOB = "send_token_payment_link"
const KEPT_STATUSES = ["pending", "sent", "paid"]

type SelectResult =
  | { ok: true; snapshot: GuestTripSnapshot }
  | { ok: false; status: number; message: string }

export const selectQuoteForGuest = async (
  supabase: SupabaseClient,
  input: { sessionId: string; quoteSnapshotId: string },
): Promise<SelectResult> => {
  const { data: quote, error: quoteError } = await supabase
    .from("quote_snapshots")
    .select("id, trip_request_id")
    .eq("id", input.quoteSnapshotId)
    .maybeSingle()

  if (quoteError) return { ok: false, status: 500, message: `Failed to fetch quote: ${quoteError.message}` }
  if (!quote?.trip_request_id) return { ok: false, status: 404, message: "No trip for this session" }

  const tripRequestId = quote.trip_request_id as string
  const allowed = await sessionCanReadTrip(supabase, input.sessionId, tripRequestId)
  if (!allowed) return { ok: false, status: 404, message: "No trip for this session" }

  const { data: existing, error: existingError } = await supabase
    .from("whatsapp_payment_intents")
    .select("id, quote_snapshot_id, status, created_at")
    .eq("trip_request_id", tripRequestId)
    .eq("purpose", "token_lock")
    .in("status", KEPT_STATUSES)
    .order("created_at", { ascending: true })

  if (existingError) return { ok: false, status: 500, message: `Failed to fetch payment intents: ${existingError.message}` }

  const openIntents = existing ?? []
  if (openIntents.length === 0) {
    const { error: jobError } = await supabase.from("job_queue").insert({
      job_type: TOKEN_JOB,
      payload: { quote_snapshot_id: input.quoteSnapshotId },
    })
    if (jobError) return { ok: false, status: 500, message: `Failed to enqueue payment link: ${jobError.message}` }

    try {
      await drainDueJobs(supabase, { jobTypes: [TOKEN_JOB] })
    } catch (error) {
      console.info("[guest select] token link drain failed", error instanceof Error ? error.message : "unknown")
    }
  }

  await keepEarliestTokenIntent(supabase, tripRequestId)

  const snapshot = await loadGuestTrip(supabase, { sessionId: input.sessionId, confirming: null })
  if (!snapshot) return { ok: false, status: 404, message: "No trip for this session" }
  return { ok: true, snapshot }
}

const keepEarliestTokenIntent = async (supabase: SupabaseClient, tripRequestId: string): Promise<void> => {
  const { data, error } = await supabase
    .from("whatsapp_payment_intents")
    .select("id, created_at")
    .eq("trip_request_id", tripRequestId)
    .eq("purpose", "token_lock")
    .in("status", KEPT_STATUSES)
    .order("created_at", { ascending: true })

  if (error || !data || data.length < 2) return

  const laterIds = data.slice(1).map((row) => row.id as string)
  await supabase.from("whatsapp_payment_intents").update({ status: "expired" }).in("id", laterIds)
}
