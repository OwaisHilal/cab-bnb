import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enqueueJob } from "../jobQueue.ts";

const DRIVER_DETAILS_REGEX =
  /^DRIVER:\s*([^|]+?)\s*\|\s*(\+?\d{10,13})\s*\|\s*([A-Z0-9\- ]+?)\s*\|\s*([^|]+?)(?:\s*\|\s*(.+))?$/i;
const DRIVER_DETAILS_PREFIX_REGEX = /^DRIVER:/i;
const ACTIVE_VENDOR_BOOKING_STATUSES = ["vendor_confirming", "vendor_confirmed", "driver_attach_pending"];
const ATTACHED_OR_LATER = ["driver_attached", "ready_for_pickup", "in_trip", "completed"];

interface ParseDriverDetailsPayload {
  raw_message_text: string;
  from_phone: string;
  wa_message_id?: string;
}

interface ResolvedBooking {
  bookingId: string;
  vendorId: string;
  status: string;
  lockType: string | null;
  paymentStatus: string;
  vehicleTypeId: number | null;
}

function phoneLast10(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

function toDriverPhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (phone.trim().startsWith("+")) return phone.trim();
  return digits ? `+${digits}` : phone.trim();
}

function vendorWhatsAppLookupValues(last10: string): string[] {
  const suffix = last10.replace(/\D/g, "").slice(-10);
  if (!suffix) return [];
  return [`+91${suffix}`, `91${suffix}`, suffix, `+${suffix}`];
}

function shouldOpsAlertUnresolvedSender(rawMessage: string): boolean {
  return /^DRIVER:/i.test(rawMessage.trim());
}

function isMissingFleet(error: { code?: string; message: string }): boolean {
  const code = error.code ?? "";
  const message = error.message.toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    ((message.includes("drivers") || message.includes("vehicles") || message.includes("driver_vehicle_links")) &&
      (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find")))
  );
}

async function findVendorIdByWhatsApp(
  supabase: SupabaseClient,
  fromPhone: string,
): Promise<string | null> {
  const suffix = phoneLast10(fromPhone);
  if (!suffix) return null;

  const { data: exact, error: exactError } = await supabase
    .from("vendors")
    .select("id, whatsapp_number")
    .in("whatsapp_number", vendorWhatsAppLookupValues(suffix))
    .limit(5);
  if (exactError) throw new Error(`Failed to look up vendors: ${exactError.message}`);
  const exactMatch = (exact ?? []).find(
    (row: { id: string; whatsapp_number: string }) => phoneLast10(row.whatsapp_number) === suffix,
  );
  if (exactMatch) return exactMatch.id as string;

  const { data: fuzzy, error: fuzzyError } = await supabase
    .from("vendors")
    .select("id, whatsapp_number")
    .ilike("whatsapp_number", `%${suffix}`)
    .limit(5);
  if (fuzzyError) throw new Error(`Failed to look up vendors: ${fuzzyError.message}`);
  const fuzzyMatch = (fuzzy ?? []).find(
    (row: { id: string; whatsapp_number: string }) => phoneLast10(row.whatsapp_number) === suffix,
  );
  return (fuzzyMatch?.id as string | undefined) ?? null;
}

async function findActiveBookingForVendorPhone(
  supabase: SupabaseClient,
  fromPhone: string,
): Promise<ResolvedBooking | null> {
  const vendorId = await findVendorIdByWhatsApp(supabase, fromPhone);
  if (!vendorId) return null;

  const selectCols = "id, vendor_id, status, lock_type, payment_status, vehicle_type_id";
  const mapBooking = (booking: {
    id: string;
    vendor_id: string;
    status: string;
    lock_type: string | null;
    payment_status: string;
    vehicle_type_id: number | null;
  }): ResolvedBooking => ({
    bookingId: booking.id,
    vendorId: booking.vendor_id,
    status: booking.status,
    lockType: booking.lock_type,
    paymentStatus: booking.payment_status,
    vehicleTypeId: booking.vehicle_type_id,
  });

  const { data: waiting, error: waitingError } = await supabase
    .from("bookings")
    .select(selectCols)
    .eq("vendor_id", vendorId)
    .in("status", [...ACTIVE_VENDOR_BOOKING_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (waitingError) throw new Error(`Failed to look up active booking for vendor: ${waitingError.message}`);
  if (waiting) return mapBooking(waiting);

  const { data: attached, error: attachedError } = await supabase
    .from("bookings")
    .select(selectCols)
    .eq("vendor_id", vendorId)
    .in("status", [...ATTACHED_OR_LATER])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (attachedError) throw new Error(`Failed to look up active booking for vendor: ${attachedError.message}`);
  if (!attached) return null;
  return mapBooking(attached);
}

export async function handleParseDriverDetails(
  supabase: SupabaseClient,
  payload: ParseDriverDetailsPayload,
): Promise<void> {
  const raw = (payload.raw_message_text ?? "").trim();
  const resolved = await findActiveBookingForVendorPhone(supabase, payload.from_phone);

  if (!resolved) {
    if (shouldOpsAlertUnresolvedSender(raw)) {
      await enqueueJob(supabase, "ops_alert", {
        reason: "driver_details_unresolved_vendor_or_booking",
        from_phone: payload.from_phone,
        raw_message_text: raw,
        wa_message_id: payload.wa_message_id,
      });
    }
    return;
  }

  if (ATTACHED_OR_LATER.includes(resolved.status) || resolved.paymentStatus === "fully_paid") {
    return;
  }

  const match = raw.match(DRIVER_DETAILS_REGEX);
  if (match) {
    const [, name, phone, vehicleNumber, vehicleModel] = match;
    await recordAndAttach(supabase, resolved, {
      fullName: name.trim(),
      phoneE164: toDriverPhoneE164(phone.trim()),
      vehicleNumber: vehicleNumber.trim(),
      vehicleModel: vehicleModel.trim(),
    }, raw, payload.wa_message_id, true);
    return;
  }

  const digits = raw.replace(/\D/g, "");
  const isPhoneOnly = /^\+?[\d\s\-()]{10,20}$/.test(raw) && digits.length >= 10 && digits.length <= 13;
  if (isPhoneOnly) {
    const last10 = phoneLast10(raw);
    const { data: driver, error } = await supabase
      .from("drivers")
      .select("id, full_name, phone_e164")
      .eq("vendor_id", resolved.vendorId)
      .eq("phone_last10", last10)
      .eq("status", "active")
      .maybeSingle();

    if (error && !isMissingFleet(error)) {
      throw new Error(`Failed to look up driver by phone: ${error.message}`);
    }
    if (!driver) {
      await supabase.from("driver_detail_submissions").insert({
        booking_id: resolved.bookingId,
        vendor_id: resolved.vendorId,
        raw_message_text: raw,
        parse_status: "parse_failed",
        wa_message_id: payload.wa_message_id,
      });
      await enqueueJob(supabase, "ops_alert", {
        reason: "unmatched_driver",
        booking_id: resolved.bookingId,
        vendor_id: resolved.vendorId,
        raw_message_text: raw,
        wa_message_id: payload.wa_message_id,
      });
      return;
    }

    const { data: link } = await supabase
      .from("driver_vehicle_links")
      .select("vehicle_id, vehicles(registration_number, model)")
      .eq("driver_id", driver.id)
      .eq("is_primary", true)
      .maybeSingle();
    const vehicle = Array.isArray(link?.vehicles) ? link?.vehicles[0] : link?.vehicles;

    await recordAndAttach(supabase, resolved, {
      driverId: driver.id as string,
      vehicleId: (link?.vehicle_id as string | null) ?? null,
      fullName: driver.full_name as string,
      phoneE164: driver.phone_e164 as string,
      vehicleNumber: (vehicle as { registration_number?: string } | null)?.registration_number ?? "TBD",
      vehicleModel: (vehicle as { model?: string } | null)?.model ?? "Vehicle",
    }, raw, payload.wa_message_id, false);
    return;
  }

  if (DRIVER_DETAILS_PREFIX_REGEX.test(raw)) {
    await supabase.from("driver_detail_submissions").insert({
      booking_id: resolved.bookingId,
      vendor_id: resolved.vendorId,
      raw_message_text: raw,
      parse_status: "parse_failed",
      wa_message_id: payload.wa_message_id,
    });
    await enqueueJob(supabase, "ops_alert", {
      reason: "driver_details_parse_failed",
      booking_id: resolved.bookingId,
      vendor_id: resolved.vendorId,
      raw_message_text: raw,
      wa_message_id: payload.wa_message_id,
    });
  }
}

async function recordAndAttach(
  supabase: SupabaseClient,
  booking: ResolvedBooking,
  driver: {
    driverId?: string;
    vehicleId?: string | null;
    fullName: string;
    phoneE164: string;
    vehicleNumber: string;
    vehicleModel: string;
  },
  raw: string,
  waMessageId: string | undefined,
  upsertFleet: boolean,
): Promise<void> {
  let driverId = driver.driverId ?? "";
  let vehicleId = driver.vehicleId ?? "";

  if (upsertFleet) {
    const last10 = phoneLast10(driver.phoneE164);
    const { data: existingDriver } = await supabase
      .from("drivers")
      .select("id")
      .eq("vendor_id", booking.vendorId)
      .eq("phone_last10", last10)
      .maybeSingle();
    if (existingDriver?.id) {
      driverId = existingDriver.id as string;
    } else {
      const { data: inserted, error } = await supabase
        .from("drivers")
        .insert({
          vendor_id: booking.vendorId,
          full_name: driver.fullName,
          phone_e164: driver.phoneE164,
          status: "active",
        })
        .select("id")
        .maybeSingle();
      if (error && !isMissingFleet(error)) throw new Error(`Failed to insert driver: ${error.message}`);
      driverId = (inserted?.id as string) ?? "";
    }

    const { data: existingVehicle } = await supabase
      .from("vehicles")
      .select("id")
      .eq("vendor_id", booking.vendorId)
      .eq("registration_number", driver.vehicleNumber)
      .maybeSingle();
    if (existingVehicle?.id) {
      vehicleId = existingVehicle.id as string;
    } else {
      const { data: insertedVehicle, error } = await supabase
        .from("vehicles")
        .insert({
          vendor_id: booking.vendorId,
          vehicle_type_id: booking.vehicleTypeId,
          registration_number: driver.vehicleNumber,
          model: driver.vehicleModel,
        })
        .select("id")
        .maybeSingle();
      if (error && !isMissingFleet(error)) throw new Error(`Failed to insert vehicle: ${error.message}`);
      vehicleId = (insertedVehicle?.id as string) ?? "";
    }

    if (driverId && vehicleId) {
      const { error: clearError } = await supabase
        .from("driver_vehicle_links")
        .update({ is_primary: false })
        .eq("driver_id", driverId)
        .eq("is_primary", true)
        .neq("vehicle_id", vehicleId);
      if (clearError && !isMissingFleet(clearError)) {
        throw new Error(`Failed to clear previous primary vehicle: ${clearError.message}`);
      }
      const { error: upsertError } = await supabase.from("driver_vehicle_links").upsert(
        { driver_id: driverId, vehicle_id: vehicleId, is_primary: true },
        { onConflict: "driver_id,vehicle_id" },
      );
      if (upsertError && !isMissingFleet(upsertError)) {
        throw new Error(`Failed to set primary vehicle: ${upsertError.message}`);
      }
    }
  }

  const { error: insertError } = await supabase.from("driver_detail_submissions").insert({
    booking_id: booking.bookingId,
    vendor_id: booking.vendorId,
    raw_message_text: raw,
    parsed_driver_name: driver.fullName,
    parsed_driver_phone: driver.phoneE164,
    parsed_vehicle_number: driver.vehicleNumber,
    parsed_vehicle_model: driver.vehicleModel,
    parse_status: "parsed_ok",
    wa_message_id: waMessageId,
    parsed_at: new Date().toISOString(),
  });
  if (insertError) throw new Error(`Failed to record parsed_ok submission: ${insertError.message}`);

  const update: Record<string, unknown> = { status: "driver_attached" };
  if (driverId) update.driver_id = driverId;
  if (vehicleId) update.vehicle_id = vehicleId;

  const { data: updated, error: updateError } = await supabase
    .from("bookings")
    .update(update)
    .eq("id", booking.bookingId)
    .in("status", ACTIVE_VENDOR_BOOKING_STATUSES)
    .select("id")
    .maybeSingle();
  if (updateError) throw new Error(`Failed to update booking to driver_attached: ${updateError.message}`);
  if (!updated?.id) return;

  if (booking.lockType === "token_99") {
    await enqueueJob(supabase, "send_balance_payment", { booking_id: booking.bookingId });
    return;
  }
  await enqueueJob(supabase, "send_confirmation_card", { booking_id: booking.bookingId });
}
