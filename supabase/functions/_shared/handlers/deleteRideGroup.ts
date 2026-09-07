import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { deleteMsg91WhatsAppGroup } from "../msg91Groups.ts";
import { isDemoRideGroupId } from "../rideGroup.ts";

export async function handleDeleteRideGroup(
  supabase: SupabaseClient,
  payload: { booking_id: string },
): Promise<void> {
  const bookingId = payload.booking_id;
  if (!bookingId) throw new Error("delete_ride_group requires booking_id");

  const { data: group, error } = await supabase
    .from("whatsapp_ride_groups")
    .select("id, msg91_group_id, status, deleted_at")
    .eq("booking_id", bookingId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`Failed to load ride group: ${error.message}`);
  if (!group || group.status === "deleted") return;

  await supabase.from("whatsapp_ride_groups").update({ status: "deleting" }).eq("id", group.id);

  const msg91GroupId = group.msg91_group_id as string;
  if (!isDemoRideGroupId(msg91GroupId)) {
    const deleted = await deleteMsg91WhatsAppGroup(msg91GroupId);
    if (!deleted.success) {
      await supabase
        .from("whatsapp_ride_groups")
        .update({ status: "failed", last_error: deleted.error ?? "delete_failed" })
        .eq("id", group.id);
      throw new Error(deleted.error ?? "Failed to delete WhatsApp group");
    }
  }

  await supabase
    .from("whatsapp_ride_groups")
    .update({
      status: "deleted",
      deleted_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", group.id);

  await supabase.from("whatsapp_ride_group_events").insert({
    group_id: group.id,
    booking_id: bookingId,
    event_type: "deleted",
    participant_role: "business",
    metadata: {},
  });
}
