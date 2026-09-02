import type { SupabaseClient } from "@supabase/supabase-js"
import { asRecord, newGroupId, newJoinRequestId, readString, stripPhone } from "./ids"

export type SimGroupRow = {
  id: string
  subject: string | null
  integrated_number: string | null
  invite_link: string | null
  raw: Record<string, unknown>
  created_at: string
  updated_at: string
}

export async function createGroup(
  supabase: SupabaseClient,
  raw: Record<string, unknown>,
): Promise<SimGroupRow> {
  const id = readString(raw, ["id", "group_id", "groupId"]) ?? newGroupId()
  const subject = readString(raw, ["subject", "name", "title"]) ?? "Group"
  const integratedNumber = readString(raw, ["integrated_number", "integratedNumber"])
  const inviteLink = `https://chat.whatsapp.com/${id.replace(/@g\.us$/, "")}`

  const { data, error } = await supabase
    .from("msg91_sim_groups")
    .insert({
      id,
      subject,
      integrated_number: integratedNumber ? stripPhone(integratedNumber) : null,
      invite_link: inviteLink,
      raw,
    })
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create group")
  }
  return data as SimGroupRow
}

export async function listGroups(supabase: SupabaseClient): Promise<SimGroupRow[]> {
  const { data, error } = await supabase
    .from("msg91_sim_groups")
    .select("*")
    .order("created_at", { ascending: false })
  if (error) {
    throw new Error(error.message)
  }
  return (data ?? []) as SimGroupRow[]
}

export async function getGroup(
  supabase: SupabaseClient,
  groupId: string,
): Promise<SimGroupRow | null> {
  const { data, error } = await supabase
    .from("msg91_sim_groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle()
  if (error) {
    throw new Error(error.message)
  }
  return (data as SimGroupRow | null) ?? null
}

export async function deleteGroup(supabase: SupabaseClient, groupId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("msg91_sim_groups")
    .delete()
    .eq("id", groupId)
    .select("id")
  if (error) {
    throw new Error(error.message)
  }
  return (data?.length ?? 0) > 0
}

export async function listJoinRequests(
  supabase: SupabaseClient,
  groupId: string,
  integratedNumber?: string,
): Promise<unknown[]> {
  let query = supabase
    .from("msg91_sim_group_join_requests")
    .select("*")
    .eq("group_id", groupId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })

  if (integratedNumber) {
    query = query.eq("integrated_number", stripPhone(integratedNumber))
  }

  const { data, error } = await query
  if (error) {
    throw new Error(error.message)
  }
  return data ?? []
}

export async function injectJoinRequest(
  supabase: SupabaseClient,
  input: {
    groupId: string
    waId: string
    displayName?: string
    integratedNumber?: string
    raw?: Record<string, unknown>
  },
) {
  const group = await getGroup(supabase, input.groupId)
  if (!group) {
    throw new Error("Group not found")
  }

  const raw = input.raw ?? asRecord(input) ?? {}
  const { data, error } = await supabase
    .from("msg91_sim_group_join_requests")
    .insert({
      id: newJoinRequestId(),
      group_id: input.groupId,
      wa_id: stripPhone(input.waId),
      display_name: input.displayName ?? null,
      integrated_number: input.integratedNumber
        ? stripPhone(input.integratedNumber)
        : group.integrated_number,
      status: "pending",
      raw,
    })
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create join request")
  }
  return data
}
