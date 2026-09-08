import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enqueueJob } from "../jobQueue.ts";
import { logOutboundWhatsAppMessage } from "../messageLog.ts";
import { ensureMessageTemplates } from "../messageTemplateStore.ts";
import { firstOrSelf } from "../relations.ts";
import { sendMsg91TemplateMessage } from "../msg91WhatsApp.ts";
import { shouldUseMsg91ApprovedTemplates } from "../useApprovedTemplates.ts";
import { sendWhatsAppCtaUrlMessage, sendWhatsAppTextMessage } from "../whatsapp.ts";
import {
  buildDriverRideGroupInvite,
  buildGuestRideGroupInvite,
  firstName,
  formatRidePickupLine,
  type RideGroupInviteSpec,
} from "../rideGroup.ts";

function toDriverPhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (phone.trim().startsWith("+")) return phone.trim();
  return digits ? `+${digits}` : phone.trim();
}

async function deliverRideGroupInvite(
  supabase: SupabaseClient,
  input: {
    phoneE164: string;
    spec: RideGroupInviteSpec;
    envNameKey: string;
    envNamespaceKey: string;
    bookingId: string;
    tripRequestId?: string;
    touristId?: string;
  },
): Promise<void> {
  const templateName = Deno.env.get(input.envNameKey)?.trim() || input.spec.templateKey;
  const namespace = Deno.env.get(input.envNamespaceKey)?.trim();
  let send = shouldUseMsg91ApprovedTemplates()
    ? await sendMsg91TemplateMessage({
        toE164: input.phoneE164,
        templateName,
        languageCode: Deno.env.get("MSG91_OTP_TEMPLATE_LANGUAGE")?.trim() || "en_US",
        namespace: namespace || undefined,
        components: input.spec.msg91Components,
      })
    : { configured: true, success: false };
  if (!send.success) {
    send = await sendWhatsAppCtaUrlMessage(input.phoneE164, input.spec.bodyText, {
      title: input.spec.ctaTitle,
      url: input.spec.inviteLink,
    }, { footerText: input.spec.footerText });
  }
  if (!send.success) {
    send = await sendWhatsAppTextMessage(input.phoneE164, input.spec.bodyText);
  }
  if (!send.success) {
    throw new Error(send.error ?? "Failed to send ride group invite");
  }
  await logOutboundWhatsAppMessage(supabase, {
    bookingId: input.bookingId,
    tripRequestId: input.tripRequestId,
    touristId: input.touristId,
    bodySnapshot: input.spec.bodyText,
    waMessageId: send.waMessageId,
    waStatus: "sent",
    templateName: input.spec.templateKey,
  });
}

export async function handleRemindRideGroupJoin(
  supabase: SupabaseClient,
  payload: { booking_id: string },
): Promise<void> {
  const bookingId = payload.booking_id;
  if (!bookingId) throw new Error("remind_ride_group_join requires booking_id");

  await ensureMessageTemplates(supabase);

  const { data: group, error: groupError } = await supabase
    .from("whatsapp_ride_groups")
    .select("id, invite_link, customer_joined_at, driver_joined_at, status")
    .eq("booking_id", bookingId)
    .is("deleted_at", null)
    .maybeSingle();

  if (groupError) throw new Error(`Failed to load ride group: ${groupError.message}`);
  if (!group || group.status === "deleted" || group.status === "deleting") return;
  if (!group.invite_link) return;
  if (group.customer_joined_at && group.driver_joined_at) return;

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, booking_ref, pickup_at, tourist_id, trip_request_id, tourists(phone_e164, full_name), trip_requests(pickup_location)",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`);
  if (!booking) return;

  const tourist = firstOrSelf(
    booking.tourists as
      | { phone_e164: string; full_name: string | null }
      | { phone_e164: string; full_name: string | null }[]
      | null,
  );
  const trip = firstOrSelf(
    booking.trip_requests as { pickup_location: string | null } | { pickup_location: string | null }[] | null,
  );
  const pickupLine = formatRidePickupLine({
    pickupLocation: trip?.pickup_location,
    pickupAt: booking.pickup_at as string,
  });
  const inviteLink = group.invite_link as string;

  if (!group.customer_joined_at && tourist?.phone_e164) {
    await deliverRideGroupInvite(supabase, {
      phoneE164: tourist.phone_e164,
      spec: buildGuestRideGroupInvite({
        bookingRef: booking.booking_ref as string,
        pickupLine,
        inviteLink,
      }),
      envNameKey: "MSG91_RIDE_GROUP_GUEST_TEMPLATE_NAME",
      envNamespaceKey: "MSG91_RIDE_GROUP_GUEST_TEMPLATE_NAMESPACE",
      bookingId,
      tripRequestId: booking.trip_request_id as string | undefined,
      touristId: booking.tourist_id as string | undefined,
    });
  }

  if (!group.driver_joined_at) {
    const { data: driverDetail } = await supabase
      .from("driver_detail_submissions")
      .select("parsed_driver_phone")
      .eq("booking_id", bookingId)
      .in("parse_status", ["parsed_ok", "ops_corrected"])
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const driverPhone = (driverDetail?.parsed_driver_phone as string | null)?.trim();
    if (driverPhone) {
      try {
        await deliverRideGroupInvite(supabase, {
          phoneE164: toDriverPhoneE164(driverPhone),
          spec: buildDriverRideGroupInvite({
            guestName: firstName(tourist?.full_name),
            pickupLine,
            inviteLink,
          }),
          envNameKey: "MSG91_RIDE_GROUP_DRIVER_TEMPLATE_NAME",
          envNamespaceKey: "MSG91_RIDE_GROUP_DRIVER_TEMPLATE_NAMESPACE",
          bookingId,
          tripRequestId: booking.trip_request_id as string | undefined,
        });
      } catch (error) {
        console.error("[remind_ride_group_join] driver reminder failed", error);
      }
    }
  }

  await enqueueJob(supabase, "ops_alert", {
    reason: "ride_group_join_pending",
    booking_id: bookingId,
    customer_joined: Boolean(group.customer_joined_at),
    driver_joined: Boolean(group.driver_joined_at),
  });
}
