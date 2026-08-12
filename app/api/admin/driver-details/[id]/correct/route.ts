import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { checkAdminAuth } from "@/lib/api/adminAuth";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";

const correctSchema = z.object({
  parsed_driver_name: z.string().min(1),
  parsed_driver_phone: z.string().min(1),
  parsed_vehicle_number: z.string().min(1),
  parsed_vehicle_model: z.string().min(1),
  parsed_vehicle_type: z.string().min(1).optional(),
});

/**
 * Checklist 2.7: ops manually corrects a `parse_failed`
 * driver_detail_submissions row (Plan §7.3's regex fallback queue), then
 * triggers the confirmation-card send job (Checklist 3.7, dispatched by
 * job-queue-worker's `send_confirmation_card` handler).
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/admin/driver-details/[id]/correct">) {
  const auth = checkAdminAuth(request);
  if (!auth.ok) return jsonError(auth.status, auth.message);

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = correctSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const { data: submission, error: fetchError } = await supabase
    .from("driver_detail_submissions")
    .select("id, booking_id, parse_status")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) return jsonError(500, `Failed to fetch driver detail submission: ${fetchError.message}`);
  if (!submission) return jsonError(404, `driver_detail_submission ${id} not found`);
  if (submission.parse_status !== "parse_failed") {
    return jsonError(409, `driver_detail_submission ${id} is not in parse_failed status`);
  }

  const { data: updated, error: updateError } = await supabase
    .from("driver_detail_submissions")
    .update({
      parsed_driver_name: parsed.data.parsed_driver_name,
      parsed_driver_phone: parsed.data.parsed_driver_phone,
      parsed_vehicle_number: parsed.data.parsed_vehicle_number,
      parsed_vehicle_model: parsed.data.parsed_vehicle_model,
      parsed_vehicle_type: parsed.data.parsed_vehicle_type ?? null,
      parse_status: "ops_corrected",
      parsed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (updateError) return jsonError(500, `Failed to correct driver detail submission: ${updateError.message}`);

  const { error: jobEnqueueError } = await supabase.from("job_queue").insert({
    job_type: "send_confirmation_card",
    payload: { driver_detail_submission_id: id, booking_id: submission.booking_id },
  });

  if (jobEnqueueError) {
    return jsonError(500, `Failed to enqueue send_confirmation_card job: ${jobEnqueueError.message}`);
  }

  return jsonOk({ driver_detail_submission: updated });
}
