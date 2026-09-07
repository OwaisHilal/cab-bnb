import type { InboundWhatsAppMessage, ParsedAction } from "./types";
import { parseWholeBodyPhone } from "@/lib/drivers/phone";

const DRIVER_DETAILS_REGEX =
  /^DRIVER:\s*([^|]+?)\s*\|\s*(\+?\d{10,13})\s*\|\s*([A-Z0-9\- ]+?)\s*\|\s*([^|]+?)(?:\s*\|\s*(.+))?$/i;
const DRIVER_DETAILS_PREFIX_REGEX = /^DRIVER:/i;
const RATE_ACTION_PREFIX = "RATE_";

/**
 * Plan §7.2 (button payload branching) / §7.3 (strict `DRIVER:` free-text
 * regex). Returns `{ type: "unknown" }` for anything that doesn't match a
 * known action, so the webhook route can safely log-only rather than guess
 * at an action from unrecognized input.
 */
export function parseInboundAction(message: InboundWhatsAppMessage): ParsedAction {
  if (message.buttonPayload) {
    return parseButtonPayload(message.buttonPayload);
  }

  if (message.textBody) {
    return parseTextBody(message.textBody);
  }

  return { type: "unknown" };
}

function parseButtonPayload(payload: string): ParsedAction {
  const [action, entityId] = payload.split("::");

  switch (action) {
    case "BOOK_FULL":
      return entityId ? { type: "book_full", quoteSnapshotId: entityId } : { type: "unknown" };
    case "BOOK_TOKEN":
      return entityId ? { type: "book_token", quoteSnapshotId: entityId } : { type: "unknown" };
    case "TOKEN_PAY":
      return entityId ? { type: "token_pay", quoteSnapshotId: entityId } : { type: "unknown" };
    case "NEGOTIATE":
      return entityId ? { type: "negotiate", quoteSnapshotId: entityId } : { type: "unknown" };
    case "COMPLETE_PAYMENT":
      return entityId ? { type: "complete_payment", bookingId: entityId } : { type: "unknown" };
    case "BALANCE_PAY":
      return entityId ? { type: "complete_payment", bookingId: entityId } : { type: "unknown" };
    case "CHECKIN_OK":
      return entityId ? { type: "checkin_ok", lifecycleEventId: entityId } : { type: "unknown" };
    case "CHECKIN_HELP":
      return entityId ? { type: "checkin_help", lifecycleEventId: entityId } : { type: "unknown" };
    default:
      return parseRatingAction(action, entityId);
  }
}

function parseRatingAction(action: string | undefined, entityId: string | undefined): ParsedAction {
  if (!action?.startsWith(RATE_ACTION_PREFIX) || !entityId) {
    return { type: "unknown" };
  }

  const rating = Number.parseInt(action.slice(RATE_ACTION_PREFIX.length), 10);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { type: "unknown" };
  }

  return { type: "rate", bookingId: entityId, rating };
}

function parseTextBody(text: string): ParsedAction {
  const match = text.match(DRIVER_DETAILS_REGEX);
  if (match) {
    const [, name, phone, vehicleNumber, vehicleModel] = match;
    return {
      type: "driver_details",
      driverDetails: {
        name: name.trim(),
        phone: phone.trim(),
        vehicleNumber: vehicleNumber.trim(),
        vehicleModel: vehicleModel.trim(),
      },
    };
  }

  if (DRIVER_DETAILS_PREFIX_REGEX.test(text.trim())) {
    return { type: "driver_details" };
  }

  const phone = parseWholeBodyPhone(text);
  if (phone) {
    return { type: "driver_details", driverDetails: { phone } };
  }

  return { type: "unknown" };
}
