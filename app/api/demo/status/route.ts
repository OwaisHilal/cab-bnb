import { jsonError, jsonOk } from "@/lib/api/errors"
import { DEMO_DISPATCH_DELAY_MS } from "@/lib/demo/runDemoPostVerification"
import { DEMO_OTP_CODE, isDemoMode } from "@/lib/otp/demoMode"

export async function GET() {
  if (!isDemoMode()) {
    return jsonError(404, "Demo flow is not enabled")
  }

  return jsonOk({
    enabled: true,
    otp_code: DEMO_OTP_CODE,
    dispatch_delay_ms: DEMO_DISPATCH_DELAY_MS,
    auto_whatsapp: true,
  })
}
