import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Checklist 3.10 / Phase 3 final pass: generic ops escalation channel.
 * No specific provider (Slack/Twilio/email) has been chosen yet, so this
 * posts to a single configurable `OPS_ALERT_WEBHOOK_URL` — any provider
 * that accepts a JSON webhook (Slack incoming webhook, a Zapier/Make relay,
 * a custom ops dashboard endpoint, etc.) can be pointed at it without code
 * changes. When unset, falls back to the previous console-only behavior so
 * local/dev environments don't retry forever against a destination that
 * doesn't exist.
 */
export async function handleOpsAlert(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<void> {
  void supabase;

  const webhookUrl = Deno.env.get("OPS_ALERT_WEBHOOK_URL");

  if (!webhookUrl) {
    console.error("[ops-alert]", JSON.stringify(payload));
    return;
  }

  const body = {
    source: "kashmirbnb-cabs",
    sent_at: new Date().toISOString(),
    ...payload,
  };

  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(
      `Failed to deliver ops_alert to OPS_ALERT_WEBHOOK_URL: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (!response.ok) {
    throw new Error(`ops_alert webhook returned ${response.status}: ${await response.text().catch(() => "")}`);
  }
}
