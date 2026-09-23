import { after, NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonErrorCode, jsonOk, jsonValidationError } from "@/lib/api/errors";
import { drainDueJobs } from "@/lib/jobs/drainDueJobs";
import { verifyVendorAssignToken } from "@/lib/whatsapp/vendorAssignToken";
import { assignDriverToBooking, loadVendorBookingById, type AssignDriverInput } from "@/lib/whatsapp/assignDriverToBooking";

export const runtime = "nodejs";

const existingModeSchema = z.object({
  token: z.string().min(1),
  mode: z.literal("existing"),
  driver_id: z.string().uuid(),
  vehicle_id: z.string().uuid().optional(),
});

const manualModeSchema = z.object({
  token: z.string().min(1),
  mode: z.literal("manual"),
  driver_name: z.string().trim().min(1).max(120),
  driver_phone: z.string().trim().min(10).max(20),
  vehicle_number: z.string().trim().min(1).max(20),
  vehicle_model: z.string().trim().min(1).max(60),
});

const assignDriverSchema = z.discriminatedUnion("mode", [existingModeSchema, manualModeSchema]);

/**
 * Submit handler for the "Assign driver" web form (app/vendor/assign-driver)
 * linked from the vendor's WhatsApp CTA (lib/whatsapp/notifyVendorBooking.ts).
 * The signed `token` (lib/whatsapp/vendorAssignToken.ts) is the only auth —
 * there's no vendor login system — so every check here (signature, expiry,
 * vendor-id match, booking status) matters.
 *
 * Two request shapes (`mode: "existing" | "manual"`), matching
 * AssignDriverInput in assignDriverToBooking.ts:
 * - `existing`: vendor picked a saved driver from lib/vendor-assign's
 *   roster. Only `driver_id`/`vehicle_id` are trusted from the client —
 *   name/phone/vehicle are always re-read server-side by ID, scoped to
 *   this booking's vendor.
 * - `manual`: vendor typed driver/vehicle details by hand. If the phone
 *   already belongs to a different saved driver, this returns
 *   `existing_driver_name_mismatch` (409) instead of renaming that driver.
 *
 * Delegates the actual upsert/attach logic to assignDriverToBooking.ts,
 * the same helper the free-text `DRIVER: ...` WhatsApp reply path uses
 * (lib/whatsapp/parseDriverDetails.ts), so both paths produce identical
 * booking/job outcomes. Every failure reason maps to a stable `code` so
 * the form can show a precise recovery action instead of a generic error.
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

  const { token } = parsed.data;

  let verified;
  try {
    verified = verifyVendorAssignToken(token);
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Server is not configured");
  }

  if (!verified.ok) {
    if (verified.reason === "expired") {
      return jsonErrorCode(
        410,
        "expired_token",
        "This link has expired. Ask for a fresh one from the booking notification.",
      );
    }
    return jsonErrorCode(401, "invalid_token", "This link is invalid.");
  }

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const booking = await loadVendorBookingById(supabase, verified.payload.bookingId);
  if (!booking) return jsonErrorCode(404, "booking_not_found", "Booking not found");
  if (booking.vendorId !== verified.payload.vendorId) {
    return jsonErrorCode(403, "invalid_token", "This link is no longer valid for this booking");
  }

  const driverInput: AssignDriverInput =
    parsed.data.mode === "existing"
      ? { mode: "existing", driverId: parsed.data.driver_id, vehicleId: parsed.data.vehicle_id ?? null }
      : {
          mode: "manual",
          driverName: parsed.data.driver_name,
          driverPhone: parsed.data.driver_phone,
          vehicleNumber: parsed.data.vehicle_number,
          vehicleModel: parsed.data.vehicle_model,
        };

  const rawMessageText =
    parsed.data.mode === "existing"
      ? `EXISTING_DRIVER: ${parsed.data.driver_id} (via web form)`
      : `DRIVER: ${parsed.data.driver_name} | ${parsed.data.driver_phone} | ${parsed.data.vehicle_number} | ${parsed.data.vehicle_model} (via web form)`;

  const result = await assignDriverToBooking(supabase, booking, driverInput, { rawMessageText });

  if (!result.ok) {
    if (result.reason === "existing_driver_name_mismatch") {
      return jsonErrorCode(
        409,
        "existing_driver_name_mismatch",
        `A driver with this phone number is already saved as "${result.existingDriver.fullName}". Use that saved driver instead of adding a new one.`,
        { existingDriver: result.existingDriver },
      );
    }
    if (result.reason === "driver_not_found") {
      return jsonErrorCode(404, "driver_not_found", "That saved driver could not be found. Please refresh and choose again.");
    }
    if (result.reason === "inactive_driver") {
      return jsonErrorCode(409, "inactive_driver", "That driver is no longer active for this operator.");
    }
    if (result.reason === "vehicle_required") {
      return jsonErrorCode(
        400,
        "vehicle_required",
        "This driver has no vehicle on file yet — please add the vehicle number and model.",
      );
    }
    return jsonErrorCode(
      409,
      "already_assigned",
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
