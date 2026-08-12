/**
 * Restricts an Edge Function's HTTP entry point to callers presenting the
 * project's service-role key.
 *
 * By default, Supabase Edge Functions accept *any* valid Supabase JWT
 * (`verify_jwt` defaults to true but doesn't distinguish anon vs
 * service_role) — meaning the public `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * shipped to browsers would otherwise be enough to invoke
 * `job-queue-worker` or `send-quotes` directly, bypassing the
 * `CRON_SECRET` gate on app/api/cron/dispatch-jobs/route.ts entirely and
 * letting anyone force arbitrary job processing or WhatsApp sends.
 *
 * `getSupabaseServiceRoleClient()` (Next.js) always sends
 * `Authorization: Bearer <service-role key>` on `.functions.invoke(...)`,
 * so legitimate server-to-function calls are unaffected by this check.
 */
export function verifyServiceRoleCaller(req: Request): Response | null {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Missing SUPABASE_SERVICE_ROLE_KEY in the Edge Function environment" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return null;
}
