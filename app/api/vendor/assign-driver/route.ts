import { after, NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";
import { drainDueJobs } from "@/lib/jobs/drainDueJobs";
import { verifyVendorAssignToken } from "@/lib/whatsapp/vendorAssignToken";
import { assignDriverToBooking, loadVendorBookingById } from "@/lib/whatsapp/assignDriverToBooking";

export const runtime = "nodejs";

const assignDriverSchema = z.object({
  token: z.string().min(1),
  driver_name: z.string().trim().min(1).max(120),
  driver_phone: z.string().trim().min(10).max(20),
  vehicle_number: z.string().trim().min(1).max(20),
  vehicle_model: z.string().trim().min(1).max(60),
});

/**
 * Submit handler for the "Assign driver" web form (app/vendor/assign-driver)
 * linked from the vendor's WhatsApp CTA (lib/whatsapp/notifyVendorBooking.ts).
 * The signed `token` (lib/whatsapp/vendorAssignToken.ts) is the only auth —
 * there's no vendor login system — so every check here (signature, expiry,
 * vendor-id match, booking status) matters. Delegates the actual
 * driver/vehicle upsert + booking attach to assignDriverToBooking.ts, the
 * same helper the free-text `DRIVER: ...` WhatsApp reply path uses
 * (lib/whatsapp/parseDriverDetails.ts), so both paths produce identical
 * booking/job outcomes.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = assignDriverSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const { token, driver_name, driver_phone, vehicle_number, vehicle_model } = parsed.data;

  let verified;
  try {
    verified = verifyVendorAssignToken(token);
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Server is not configured");
  }

  if (!verified.ok) {
    if (verified.reason === "expired") {
      return jsonError(410, "This link has expired. Ask for a fresh one from the booking notification.");
    }
    return jsonError(401, "This link is invalid.");
  }

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const booking = await loadVendorBookingById(supabase, verified.payload.bookingId);
  if (!booking) return jsonError(404, "Booking not found");
  if (booking.vendorId !== verified.payload.vendorId) {
    return jsonError(403, "This link is no longer valid for this booking");
  }

  const result = await assignDriverToBooking(
    supabase,
    booking,
    {
      driverName: driver_name,
      driverPhone: driver_phone,
      vehicleNumber: vehicle_number,
      vehicleModel: vehicle_model,
    },
    {
      rawMessageText: `DRIVER: ${driver_name} | ${driver_phone} | ${vehicle_number} | ${vehicle_model} (via web form)`,
    },
  );

  if (!result.ok) {
    return jsonError(
      409,
      "A driver has already been assigned to this booking, or it's no longer accepting driver details.",
    );
  }

  after(async () => {
    try {
      await drainDueJobs(supabase);
    } catch (error) {
      console.error("[vendor assign-driver] drainDueJobs failed", error);
    }
  });

  return jsonOk({ assigned: true });
}
