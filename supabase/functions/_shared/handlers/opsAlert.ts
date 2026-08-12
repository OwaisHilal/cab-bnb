import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Checklist 3.10: no internal ops channel (Slack/WhatsApp) is wired up
 * yet — this mirrors the "not configured" stance already taken by the
 * SMS/email quote fallback stub in `_shared/whatsapp.ts`. Logging (instead
 * of throwing) keeps the job marked `done` rather than retrying forever
 * against a destination that doesn't exist; replace this body once a real
 * ops channel is chosen.
 */
export async function handleOpsAlert(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<void> {
  void supabase;
  console.error("[ops-alert]", JSON.stringify(payload));
  await Promise.resolve();
}
