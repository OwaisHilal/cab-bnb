import "server-only"

import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { serializeWhatsAppMessageLogPayload } from "@/lib/whatsapp/messagePayload"
import { isDemoMode } from "@/lib/otp/demoMode"
import { buildQuoteDeliveryPayload } from "@/lib/whatsapp/buildQuoteDelivery"
import { deliverQuoteWhatsApp } from "@/lib/whatsapp/deliverQuoteWhatsApp"
import { loadMockMessagingThread } from "@/lib/demo/mockMessaging"

async function countCustomerChatMessages(
  supabase: SupabaseClient,
  tripRequestId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("whatsapp_message_log")
    .select("id", { count: "exact", head: true })
    .eq("trip_request_id", tripRequestId)
    .is("vendor_id", null)

  if (error) {
    throw new Error(`Failed to count mock chat messages: ${error.message}`)
  }

  return count ?? 0
}

async function backfillDemoQuoteChatMessage(
  supabase: SupabaseClient,
  tripRequestId: string,
  quoteSnapshotId?: string,
): Promise<boolean> {
  const built = await buildQuoteDeliveryPayload(supabase, tripRequestId, {
    includeAlreadySent: true,
    quoteSnapshotId,
  })
  if ("error" in built) return false

  const { error } = await supabase.from("whatsapp_message_log").insert({
    trip_request_id: built.tripRequestId,
    quote_snapshot_id: built.bestQuoteSnapshotId,
    direction: "outbound",
    body_snapshot: built.message.bodyText,
    button_payload: serializeWhatsAppMessageLogPayload(built.message),
    wa_message_id: `demo-backfill-${randomUUID()}`,
    wa_status: "sent",
    template_name: built.message.templateKey,
  })

  if (error) {
    throw new Error(`Failed to backfill demo quote chat message: ${error.message}`)
  }

  return true
}

async function hasSelectedQuoteCard(
  supabase: SupabaseClient,
  tripRequestId: string,
  quoteSnapshotId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("whatsapp_message_log")
    .select("id", { count: "exact", head: true })
    .eq("trip_request_id", tripRequestId)
    .eq("quote_snapshot_id", quoteSnapshotId)
    .eq("direction", "outbound")
    .is("vendor_id", null)

  if (error) {
    throw new Error(`Failed to check selected quote chat message: ${error.message}`)
  }

  return (count ?? 0) > 0
}

/**
 * Demo mock chat reads whatsapp_message_log, but quote delivery can fail
 * silently after OTP (e.g. real WhatsApp creds present but invalid). Heal an
 * empty customer thread by delivering or backfilling the quote card.
 */
export async function ensureDemoMockChatQuotes(
  supabase: SupabaseClient,
  tripRequestId: string,
  quoteSnapshotId?: string,
): Promise<void> {
  if (!isDemoMode()) return

  const customerMessages = await countCustomerChatMessages(supabase, tripRequestId)

  if (customerMessages > 0) {
    if (quoteSnapshotId && !(await hasSelectedQuoteCard(supabase, tripRequestId, quoteSnapshotId))) {
      await backfillDemoQuoteChatMessage(supabase, tripRequestId, quoteSnapshotId)
    }
    return
  }

  const delivery = await deliverQuoteWhatsApp(supabase, tripRequestId)
  if (delivery.ok) return

  await backfillDemoQuoteChatMessage(supabase, tripRequestId, quoteSnapshotId)
}

export async function loadDemoMockChatThread(
  supabase: SupabaseClient,
  tripRequestId: string,
  options?: { includeVendorMessages?: boolean; quoteSnapshotId?: string },
) {
  await ensureDemoMockChatQuotes(supabase, tripRequestId, options?.quoteSnapshotId)
  return loadMockMessagingThread(supabase, tripRequestId, {
    includeVendorMessages: options?.includeVendorMessages,
    includeAllAudiences: options?.includeVendorMessages,
  })
}
