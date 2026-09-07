import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enqueueJob } from "../jobQueue.ts";
import { logOutboundWhatsAppMessage } from "../messageLog.ts";
import { ensureMessageTemplates } from "../messageTemplateStore.ts";
import { firstOrSelf } from "../relations.ts";
import {
  createMsg91WhatsAppGroup,
  sendMsg91GroupTextMessage,
} from "../msg91Groups.ts";
import { sendMsg91TemplateMessage } from "../msg91WhatsApp.ts";
import { sendWhatsAppCtaUrlMessage, sendWhatsAppTextMessage } from "../whatsapp.ts";
import {
  CREATE_RIDE_GROUP_JOB,
  DELETE_RIDE_GROUP_JOB,
  JOIN_REMINDER_DELAY_MS,
  REMIND_RIDE_GROUP_JOIN_JOB,
  buildDriverRideGroupInvite,
  buildGuestRideGroupInvite,
  buildRideGroupDescription,
  buildRideGroupSubject,
  buildRideGroupWelcomeText,
  firstName,
  formatRidePickupLine,
  isDemoRideGroupId,
  rideGroupDeleteAt,
  type RideGroupInviteSpec,
} from "../rideGroup.ts";

const DUPLICATE_KEY = "23505";

function toDriverPhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (phone.trim().startsWith("+")) return phone.trim();
  return digits ? `+${digits}` : phone.trim();
}

function isMissingRelation(error: { code?: string; message: string }): boolean {
  const code = error.code ?? "";
  const message = error.message.toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("whatsapp_ride_groups") &&
      (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find")))
  );
}

export async function enqueueCreateRideGroupJob(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<void> {
  const { data: existing, error } = await supabase
    .from("job_queue")
    .select("id")
    .eq("job_type", CREATE_RIDE_GROUP_JOB)
    .in("status", ["queued", "processing"])
    .filter("payload->>booking_id", "eq", bookingId)
    .limit(1)
    .maybeSingle();
  if (error && !isMissingRelation(error)) {
    throw new Error(`Failed to check ${CREATE_RIDE_GROUP_JOB} queue: ${error.message}`);
  }
  if (existing?.id) return;
  await enqueueJob(supabase, CREATE_RIDE_GROUP_JOB, { booking_id: bookingId });
}

async function enqueueFollowupIfMissing(
  supabase: SupabaseClient,
  jobType: string,
  bookingId: string,
  runAfter: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from("job_queue")
    .select("id")
    .eq("job_type", jobType)
    .in("status", ["queued", "processing"])
    .filter("payload->>booking_id", "eq", bookingId)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return;
  await enqueueJob(supabase, jobType, { booking_id: bookingId }, { runAfter });
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
  let send = await sendMsg91TemplateMessage({
    toE164: input.phoneE164,
    templateName,
    languageCode: Deno.env.get("MSG91_OTP_TEMPLATE_LANGUAGE")?.trim() || "en_US",
    namespace: namespace || undefined,
    components: input.spec.msg91Components,
  });
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

export async function handleCreateRideGroup(
  supabase: SupabaseClient,
  payload: { booking_id: string },
): Promise<void> {
  const bookingId = payload.booking_id;
  if (!bookingId) throw new Error("create_ride_group requires booking_id");

  await ensureMessageTemplates(supabase);

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, booking_ref, status, payment_status, pickup_at, trip_days, tourist_id, vendor_id, trip_request_id, tourists(phone_e164, full_name), vendors(business_name), trip_requests(pickup_location, drop_location)",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`);
  if (!booking) throw new Error(`booking ${bookingId} not found`);
  if (booking.payment_status !== "fully_paid" || booking.status !== "ready_for_pickup") {
    return;
  }

  const { data: existingGroup, error: groupLookupError } = await supabase
    .from("whatsapp_ride_groups")
    .select("id, msg91_group_id, invite_link, status, welcome_sent_at")
    .eq("booking_id", bookingId)
    .is("deleted_at", null)
    .maybeSingle();

  if (groupLookupError) {
    if (isMissingRelation(groupLookupError)) return;
    throw new Error(`Failed to load ride group: ${groupLookupError.message}`);
  }

  if (existingGroup?.status === "invited" || existingGroup?.status === "active") {
    await enqueueFollowupIfMissing(
      supabase,
      REMIND_RIDE_GROUP_JOIN_JOB,
      bookingId,
      new Date(Date.now() + JOIN_REMINDER_DELAY_MS).toISOString(),
    );
    await enqueueFollowupIfMissing(
      supabase,
      DELETE_RIDE_GROUP_JOB,
      bookingId,
      rideGroupDeleteAt(booking.pickup_at as string, booking.trip_days as number),
    );
    return;
  }

  const tourist = firstOrSelf(
    booking.tourists as
      | { phone_e164: string; full_name: string | null }
      | { phone_e164: string; full_name: string | null }[]
      | null,
  );
  if (!tourist?.phone_e164) throw new Error(`booking ${bookingId} has no tourist phone`);

  const { data: driverDetail, error: driverError } = await supabase
    .from("driver_detail_submissions")
    .select("parsed_driver_name, parsed_driver_phone, parsed_vehicle_number, parsed_vehicle_model")
    .eq("booking_id", bookingId)
    .in("parse_status", ["parsed_ok", "ops_corrected"])
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (driverError) throw new Error(`Failed to fetch driver details: ${driverError.message}`);
  if (!driverDetail) throw new Error(`booking ${bookingId} has no parsed driver details`);

  const vendorName =
    firstOrSelf(booking.vendors as { business_name: string } | { business_name: string }[] | null)?.business_name ??
    "Operator";
  const trip = firstOrSelf(
    booking.trip_requests as
      | { pickup_location: string | null; drop_location: string | null }
      | { pickup_location: string | null; drop_location: string | null }[]
      | null,
  );
  const pickupLine = formatRidePickupLine({
    pickupLocation: trip?.pickup_location,
    pickupAt: booking.pickup_at as string,
  });
  const bookingRef = booking.booking_ref as string;
  const subject = buildRideGroupSubject({
    bookingRef,
    guestName: tourist.full_name,
    vendorName,
  });
  const description = buildRideGroupDescription({
    bookingRef,
    pickupLine,
    dropLocation: trip?.drop_location,
  });

  let groupId = existingGroup?.id as string | undefined;
  let msg91GroupId = existingGroup?.msg91_group_id as string | undefined;
  let inviteLink = existingGroup?.invite_link as string | undefined;

  if (!inviteLink || !msg91GroupId) {
    const created = await createMsg91WhatsAppGroup({ subject, description });
    if (created.success && created.group?.groupId && created.group.inviteLink) {
      msg91GroupId = created.group.groupId;
      inviteLink = created.group.inviteLink;
    } else if (Deno.env.get("DEMO_MODE") === "true") {
      msg91GroupId = `demo-group-${bookingId}`;
      inviteLink = `https://chat.whatsapp.com/demo${bookingId.replace(/-/g, "").slice(0, 16)}`;
    } else {
      throw new Error(created.error ?? "Failed to create WhatsApp group");
    }

    const row = {
      booking_id: bookingId,
      msg91_group_id: msg91GroupId,
      invite_link: inviteLink,
      subject,
      description,
      join_approval_mode: "auto_approve",
      status: "created",
    };

    if (existingGroup?.id) {
      const { error: updateError } = await supabase
        .from("whatsapp_ride_groups")
        .update(row)
        .eq("id", existingGroup.id);
      if (updateError) throw new Error(`Failed to store ride group: ${updateError.message}`);
      groupId = existingGroup.id as string;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("whatsapp_ride_groups")
        .insert(row)
        .select("id")
        .maybeSingle();
      if (insertError?.code === DUPLICATE_KEY) {
        const { data: raced } = await supabase
          .from("whatsapp_ride_groups")
          .select("id, msg91_group_id, invite_link")
          .eq("booking_id", bookingId)
          .is("deleted_at", null)
          .maybeSingle();
        groupId = (raced?.id as string | undefined) ?? groupId;
        msg91GroupId = (raced?.msg91_group_id as string | undefined) ?? msg91GroupId;
        inviteLink = (raced?.invite_link as string | undefined) ?? inviteLink;
      } else if (insertError) {
        throw new Error(`Failed to store ride group: ${insertError.message}`);
      } else {
        groupId = (inserted?.id as string | undefined) ?? groupId;
      }
    }

    if (groupId) {
      await supabase.from("whatsapp_ride_group_events").insert({
        group_id: groupId,
        booking_id: bookingId,
        event_type: "created",
        participant_role: "business",
        metadata: { msg91_group_id: msg91GroupId, subject },
      });
    }
  }

  if (!groupId || !inviteLink || !msg91GroupId) {
    throw new Error("Ride group is missing invite_link after create");
  }

  await deliverRideGroupInvite(supabase, {
    phoneE164: tourist.phone_e164,
    spec: buildGuestRideGroupInvite({ bookingRef, pickupLine, inviteLink }),
    envNameKey: "MSG91_RIDE_GROUP_GUEST_TEMPLATE_NAME",
    envNamespaceKey: "MSG91_RIDE_GROUP_GUEST_TEMPLATE_NAMESPACE",
    bookingId,
    tripRequestId: booking.trip_request_id as string | undefined,
    touristId: booking.tourist_id as string | undefined,
  });

  const driverPhoneRaw = (driverDetail.parsed_driver_phone as string | null)?.trim();
  if (driverPhoneRaw) {
    try {
      await deliverRideGroupInvite(supabase, {
        phoneE164: toDriverPhoneE164(driverPhoneRaw),
        spec: buildDriverRideGroupInvite({
          guestName: firstName(tourist.full_name),
          pickupLine,
          inviteLink,
        }),
        envNameKey: "MSG91_RIDE_GROUP_DRIVER_TEMPLATE_NAME",
        envNamespaceKey: "MSG91_RIDE_GROUP_DRIVER_TEMPLATE_NAMESPACE",
        bookingId,
        tripRequestId: booking.trip_request_id as string | undefined,
      });
    } catch (error) {
      console.error("[create_ride_group] driver invite failed", error);
    }
  }

  const vehicleLine = [
    (driverDetail.parsed_vehicle_model as string | null) ?? "Vehicle",
    (driverDetail.parsed_vehicle_number as string | null) ?? "TBD",
  ].join(" · ");
  const welcome = buildRideGroupWelcomeText({
    bookingRef,
    guestName: tourist.full_name?.trim() || "Guest",
    driverName: (driverDetail.parsed_driver_name as string | null) ?? "Driver",
    vehicleLine,
    pickupLine,
  });

  if (!existingGroup?.welcome_sent_at) {
    if (isDemoRideGroupId(msg91GroupId) || Deno.env.get("DEMO_MODE") === "true") {
      await supabase
        .from("whatsapp_ride_groups")
        .update({ welcome_sent_at: new Date().toISOString() })
        .eq("id", groupId);
    } else {
      const welcomeSend = await sendMsg91GroupTextMessage({ groupId: msg91GroupId, bodyText: welcome });
      if (!welcomeSend.success) {
        console.error("[create_ride_group] welcome message failed", welcomeSend.error);
      } else {
        await supabase
          .from("whatsapp_ride_groups")
          .update({ welcome_sent_at: new Date().toISOString() })
          .eq("id", groupId);
      }
    }
  }

  await supabase
    .from("whatsapp_ride_groups")
    .update({ status: "invited", last_error: null })
    .eq("id", groupId);

  await enqueueFollowupIfMissing(
    supabase,
    REMIND_RIDE_GROUP_JOIN_JOB,
    bookingId,
    new Date(Date.now() + JOIN_REMINDER_DELAY_MS).toISOString(),
  );
  await enqueueFollowupIfMissing(
    supabase,
    DELETE_RIDE_GROUP_JOB,
    bookingId,
    rideGroupDeleteAt(booking.pickup_at as string, booking.trip_days as number),
  );
}
