import "server-only"

import { isDemoMode } from "@/lib/otp/demoMode"

/** Demo-only admin debug routes — never expose real ops data without DEMO_MODE. */
export function isDemoDebugEnabled(): boolean {
  return isDemoMode()
}
