import "server-only";
import type { NextRequest } from "next/server";

/**
 * Shared bearer-token gate for app/api/admin/** routes (Checklist 2.6, 2.7).
 * There is no admin login/session system in the repo yet — this mirrors the
 * same lightweight shared-secret pattern already used for CRON_SECRET
 * (app/api/cron/dispatch-jobs/route.ts) rather than inventing a second
 * scheme, until real admin auth is built.
 */
export function checkAdminAuth(request: NextRequest): { ok: true } | { ok: false; status: number; message: string } {
  const adminSecret = process.env.ADMIN_API_SECRET;
  if (!adminSecret) {
    return { ok: false, status: 500, message: "Missing ADMIN_API_SECRET. Copy .env.example to .env.local and fill it in." };
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${adminSecret}`) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }

  return { ok: true };
}
