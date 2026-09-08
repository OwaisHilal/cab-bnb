/**
 * Keep in sync with lib/msg91/useApprovedTemplates.ts.
 * Unset defaults to true so production does not silently drop approved templates.
 */
export function shouldUseMsg91ApprovedTemplates(
  raw: string | undefined = Deno.env.get("MSG91_USE_APPROVED_TEMPLATES"),
): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) return true;
  if (value === "false" || value === "no" || value === "0" || value === "off") return false;
  return true;
}
