import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";
import { selectQuoteForGuest } from "@/lib/guest-trip/selectQuoteForGuest";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const selectSchema = z.object({
  session_id: z.string().min(1),
  quote_snapshot_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = selectSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  try {
    const result = await selectQuoteForGuest(supabase, {
      sessionId: parsed.data.session_id,
      quoteSnapshotId: parsed.data.quote_snapshot_id,
    });
    if (!result.ok) return jsonError(result.status, result.message);
    return jsonOk(result.snapshot);
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Failed to select operator");
  }
}
