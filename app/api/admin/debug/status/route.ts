import { jsonError, jsonOk } from "@/lib/api/errors"
import { isDemoDebugEnabled } from "@/lib/admin/demoDebugAccess"

export async function GET() {
  if (!isDemoDebugEnabled()) {
    return jsonError(404, "Demo debug console is not enabled")
  }

  return jsonOk({ enabled: true, path: "/admin/debug" })
}
