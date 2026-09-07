export const MSG91_WHATSAPP_GROUPS_URL =
  "https://control.msg91.com/api/v5/whatsapp/groups";

export const RIDE_GROUP_SUBJECT_MAX = 128;
export const JOIN_APPROVAL_AUTO = "auto_approve" as const;

export interface ParsedMsg91Group {
  groupId: string | null;
  inviteLink: string | null;
  subject: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pickNonEmptyString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return asRecord(value[0]);
  }
  return asRecord(value);
}

export function parseMsg91GroupPayload(body: unknown): ParsedMsg91Group {
  const root = asRecord(body);
  if (!root) return { groupId: null, inviteLink: null, subject: null };

  const data = asRecord(root.data) ?? root;
  const group = firstRecord(data.groups) ?? firstRecord(data.group) ?? data;

  return {
    groupId:
      pickNonEmptyString(group, ["id", "group_id", "groupId"]) ??
      pickNonEmptyString(root, ["id", "group_id", "groupId"]),
    inviteLink:
      pickNonEmptyString(group, ["invite_link", "inviteLink", "link"]) ??
      pickNonEmptyString(root, ["invite_link", "inviteLink", "link"]),
    subject: pickNonEmptyString(group, ["subject", "name", "title"]),
  };
}

export function whatsAppInviteCode(inviteLink: string): string | null {
  const match = inviteLink.trim().match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
  return match?.[1] ?? null;
}

export function buildMsg91CreateGroupBody(input: {
  integratedNumber: string;
  subject: string;
  description: string;
  joinApprovalMode?: string;
}): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    integrated_number: input.integratedNumber.replace(/^\+/, ""),
    subject: input.subject.slice(0, RIDE_GROUP_SUBJECT_MAX).trim(),
    description: input.description.slice(0, 2048).trim(),
    join_approval_mode: input.joinApprovalMode ?? JOIN_APPROVAL_AUTO,
  };
}

export function buildMsg91GroupTextBody(input: {
  integratedNumber: string;
  groupId: string;
  bodyText: string;
}): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    integrated_number: input.integratedNumber.replace(/^\+/, ""),
    group_id: input.groupId,
    type: "text",
    text: { body: input.bodyText },
  };
}
