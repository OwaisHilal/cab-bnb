import { jsonError, jsonOk } from "@/lib/api/errors"
import { isDemoDebugEnabled } from "@/lib/admin/demoDebugAccess"
import { loadDebugFeed } from "@/lib/admin/loadDebugFeed"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server"

export async function GET() {
  if (!isDemoDebugEnabled()) {
    return jsonError(404, "Demo debug console is not enabled")
  }

  let supabase
  try {
    supabase = getSupabaseServiceRoleClient()
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured")
  }

  try {
    const feed = await loadDebugFeed(supabase)
    return jsonOk(feed)
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Failed to load debug feed")
  }
}
