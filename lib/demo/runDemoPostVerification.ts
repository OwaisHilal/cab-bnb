import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { deliverQuoteWhatsApp } from "@/lib/whatsapp/deliverQuoteWhatsApp"
import { isDemoMode } from "@/lib/otp/demoMode"

/** Shorter vendor-matching animation during local demos. */
export const DEMO_DISPATCH_DELAY_MS = 1500

/**
 * After OTP verify in demo mode, immediately simulate the WhatsApp quote
 * card delivery so the customer app and ops console advance without cron or
 * Meta credentials.
 */
export async function runDemoPostVerification(
  supabase: SupabaseClient,
  tripRequestId: string,
): Promise<void> {
  if (!isDemoMode()) return

  const result = await deliverQuoteWhatsApp(supabase, tripRequestId)
  if (!result.ok) {
    console.info("[demo post-verify] quote delivery skipped", result.message)
  }
}
