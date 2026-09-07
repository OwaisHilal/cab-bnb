import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Shared `job_queue` insert used by Phase 3 handlers that chain into a
 * follow-up job (e.g. `parse-driver-details` → `send_confirmation_card`,
 * or any handler escalating to `ops_alert`) — mirrors the Next-side
 * `enqueueJob` in `lib/whatsapp/webhook/enqueueWebhookAction.ts`, kept as a
 * separate Deno-side copy since Edge Functions can't import Next files.
 */
export async function enqueueJob(
  supabase: SupabaseClient,
  jobType: string,
  payload: Record<string, unknown>,
  options?: { runAfter?: string },
): Promise<void> {
  const row: Record<string, unknown> = { job_type: jobType, payload };
  if (options?.runAfter) row.run_after = options.runAfter;
  const { error } = await supabase.from("job_queue").insert(row);
  if (error) {
    throw new Error(`Failed to enqueue ${jobType} job: ${error.message}`);
  }
}
