/**
 * WhatsApp copy builders for Edge handlers — templates loaded from DB via messageTemplateStore.
 */

import {
  getMessageTemplate,
  renderMessageTemplate,
  type WhatsAppMessageTemplateRow,
} from "./messageTemplateStore.ts";
import {
  QUOTE_CHOICE_FOOTER,
  buildQuoteChoiceMsg91Components,
  buildQuoteChoiceNamedVariables,
  buildQuoteChoiceSessionButtons,
  formatQuoteChoiceTripSummary,
  type QuoteChoiceRow,
  type QuoteChoiceTripDetails,
} from "./quoteChoiceTemplate.ts";

export const TOKEN_LOCK_AMOUNT = 99;

export function formatInr(amount: number): string {
  return `\u20b9${amount.toLocaleString("en-IN")}`;
}

export function calculateTripTotal(finalQuote: number, tripDays: number): number {
  return finalQuote * tripDays;
}

export function calculateBalanceDue(finalQuote: number, tripDays: number): number {
  return Math.max(calculateTripTotal(finalQuote, tripDays) - TOKEN_LOCK_AMOUNT, 0);
}

export const TOKEN_RECEIVED_TEMPLATE_KEY = "token_received_v1";
export const VENDOR_ASSIGN_DRIVER_TEMPLATE_KEY = "vendor_assign_driver_v1";
// MSG91-facing name, approved 2026-09-23 (one URL button) — see
// docs/2026-09-21-vendor-assign-driver-v2-template.md. Fallback only when
// MSG91_VENDOR_NOTIFY_TEMPLATE_NAME isn't set; template_key above stays v1.
export const MSG91_VENDOR_ASSIGN_DRIVER_TEMPLATE_NAME = "vendor_assign_driver_v2";
export const VENDOR_ASSIGN_DRIVER_CTA_TITLE = "Assign driver";
export const DRIVER_ASSIGNED_PAYMENT_TEMPLATE_KEY = "driver_assigned_payment_v1";
export const DRIVER_ASSIGNED_PAYMENT_FOOTER = "Pay remaining balance to confirm.";

export function buildTokenReceivedAckMessage(input: {
  tripDays: number;
  paxCount: number;
  vehicleLabel: string;
  pickupLocation?: string | null;
  dropLocation?: string | null;
  vendorName: string;
}): {
  bodyText: string;
  msg91Components: Record<string, { type: string; value: string }>;
} {
  const tripSummary = formatQuoteChoiceTripSummary({
    tripDays: input.tripDays,
    paxCount: input.paxCount,
    vehicleLabel: input.vehicleLabel,
    pickupLocation: input.pickupLocation,
    dropLocation: input.dropLocation,
  });
  const vendorName = input.vendorName.trim() || "your operator";
  const template = getMessageTemplate(TOKEN_RECEIVED_TEMPLATE_KEY);
  const bodyText = renderMessageTemplate(
    template?.body_template ??
      "Payment received. Your ₹99 token is confirmed.\n\nTrip: {{trip_summary}}\nOperator: {{vendor_name}}\n\nWe are allocating a driver for you. This can take about 30 minutes.",
    { trip_summary: tripSummary, vendor_name: vendorName },
  );
  return {
    bodyText,
    msg91Components: {
      body_1: { type: "text", value: tripSummary },
      body_2: { type: "text", value: vendorName },
    },
  };
}

export function buildVendorAssignDriverMessage(input: {
  guestName: string;
  pickupLocation: string;
  dropLocation: string;
  pickupAt: string;
  tripDays: number;
  paxCount: number;
  vehicleLabel: string;
  tripTotal: number;
  assignUrl: string;
  assignToken: string;
}): {
  bodyText: string;
  ctaTitle: string;
  assignUrl: string;
  msg91Components: Record<string, { type: string; value: string; subtype?: string }>;
} {
  const dates = tripDateVariables(input.pickupAt, input.tripDays);
  const tripTotal = formatInr(input.tripTotal);
  const template = getMessageTemplate(VENDOR_ASSIGN_DRIVER_TEMPLATE_KEY);
  const renderedBody = renderMessageTemplate(
    template?.body_template ??
      "New booking confirmed.\n\nGuest: {{guest_name}}\nRoute: {{pickup}} → {{drop}}\nDate: {{pickup_date}}, {{trip_days}} {{day_label}}\nPax: {{pax_count}} | Cab: {{vehicle_label}}\nTotal: {{trip_total}}\n\nReply with the driver's 10-digit mobile to assign.\nOptional: DRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>",
    {
      guest_name: input.guestName,
      pickup: input.pickupLocation,
      drop: input.dropLocation,
      pax_count: String(input.paxCount),
      vehicle_label: input.vehicleLabel,
      trip_total: tripTotal,
      ...dates,
    },
  );
  // Same rationale as the Next.js twin in lib/whatsapp/notifyVendorBooking.ts:
  // appended (not baked into the Meta-approved body above) so the bulk
  // Utility send — which only ever wires msg91Components onto the wire —
  // is byte-identical to before. Only the session/cta_url fallback path
  // (see handlers/notifyVendorBooking.ts) shows this line + the real button.
  const bodyText = `${renderedBody}\n\nFastest way: tap "${VENDOR_ASSIGN_DRIVER_CTA_TITLE}" below to submit details from your phone.`;
  return {
    bodyText,
    ctaTitle: VENDOR_ASSIGN_DRIVER_CTA_TITLE,
    assignUrl: input.assignUrl,
    msg91Components: {
      body_1: { type: "text", value: input.guestName },
      body_2: { type: "text", value: input.pickupLocation },
      body_3: { type: "text", value: input.dropLocation },
      body_4: { type: "text", value: dates.pickup_date },
      body_5: { type: "text", value: dates.trip_days },
      body_6: { type: "text", value: dates.day_label },
      body_7: { type: "text", value: String(input.paxCount) },
      body_8: { type: "text", value: input.vehicleLabel },
      body_9: { type: "text", value: tripTotal },
      // vendor_assign_driver_v2 (Meta-approved) has one URL button whose
      // template url is fixed as .../vendor/assign-driver?token={{1}} —
      // MSG91 only needs the dynamic suffix here, not the full URL.
      button_1: { type: "text", subtype: "url", value: input.assignToken },
    },
  };
}

export function buildBalancePaymentLinkCopy(input: {
  tripDays: number;
  paxCount: number;
  vehicleLabel: string;
  pickupLocation?: string | null;
  dropLocation?: string | null;
  vendorName: string;
  pricePerDay: number;
  rating: number | null;
  driverName: string;
  vehicleModel: string;
  vehicleNumber: string;
  balanceDue: number;
}): { bodyText: string; footerText: string; itemName: string; amountInr: number; quantity: number } {
  const tripSummary = formatQuoteChoiceTripSummary({
    tripDays: input.tripDays,
    paxCount: input.paxCount,
    vehicleLabel: input.vehicleLabel,
    pickupLocation: input.pickupLocation,
    dropLocation: input.dropLocation,
  });
  const rating =
    input.rating === null || input.rating === undefined || Number.isNaN(Number(input.rating))
      ? "n/a"
      : Number(input.rating).toFixed(1);
  const vendorLine = `${input.vendorName} ${formatInr(input.pricePerDay)}/day (${rating})`;
  const tripTotal = input.pricePerDay * input.tripDays;
  const vehicleLine = `${input.vehicleModel} (${input.vehicleNumber})`;
  const body = [
    "Your driver has been assigned.",
    "",
    `Trip: ${tripSummary}`,
    vendorLine,
    `Driver: ${input.driverName} · ${vehicleLine}`,
    `Total: ${formatInr(tripTotal)} · Token paid: ${formatInr(TOKEN_LOCK_AMOUNT)} · Balance: ${formatInr(input.balanceDue)}`,
  ].join("\n");
  const dayLabel = input.tripDays === 1 ? "1 day" : `${input.tripDays} days`;
  return {
    bodyText: body.length > 1024 ? body.slice(0, 1024) : body,
    footerText: DRIVER_ASSIGNED_PAYMENT_FOOTER.slice(0, 60),
    itemName: `Balance · ${input.vendorName.trim() || "Vendor"} · ${dayLabel}`.slice(0, 60),
    amountInr: input.balanceDue,
    quantity: 1,
  };
}

function requireTemplate(templateKey: string): WhatsAppMessageTemplateRow {
  const row = getMessageTemplate(templateKey);
  if (!row) {
    throw new Error(`WhatsApp template not found: ${templateKey}`);
  }
  return row;
}

function formatPickupDate(pickupAt: string): string {
  return new Date(pickupAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function tripDateVariables(pickupAt: string, tripDays: number): Record<string, string> {
  return {
    pickup_date: formatPickupDate(pickupAt),
    trip_days: String(tripDays),
    day_label: tripDays > 1 ? "days" : "day",
  };
}

function buildListFromTemplate(
  template: WhatsAppMessageTemplateRow,
  rows: Array<{ id: string; title: string; description: string }>,
) {
  const config = template.list_config ?? {};
  return {
    buttonText: config.buttonText ?? "Choose operator",
    sections: [
      {
        title: config.sectionTitle ?? "Pay \u20b999 to lock",
        rows,
      },
    ],
  };
}

export function buildDriverBalanceMessage(input: {
  vendorName: string;
  balanceDue: number;
  bookingId: string;
}): { bodyText: string; buttons: Array<{ id: string; title: string }> } {
  const template = requireTemplate("driver_balance_v1");
  const bodyText = renderMessageTemplate(template.body_template, {
    vendor_name: input.vendorName,
    balance_due: formatInr(input.balanceDue),
  });

  return {
    bodyText,
    buttons: [
      {
        id: `COMPLETE_PAYMENT::${input.bookingId}`,
        title: `Pay ${formatInr(input.balanceDue)} Now`.slice(0, 20),
      },
    ],
  };
}

export function buildDriverContactMessage(input: {
  driverName: string;
  driverPhone: string;
  vehicleModel: string;
  vehicleNumber: string;
  vendorName: string;
}): string {
  const template = requireTemplate("driver_contact_v1");
  return renderMessageTemplate(template.body_template, {
    driver_name: input.driverName,
    driver_phone: input.driverPhone,
    vehicle_model: input.vehicleModel,
    vehicle_number: input.vehicleNumber,
    vendor_name: input.vendorName,
  });
}

export function buildDriverAssignmentMessage(input: {
  driverName: string;
  pickupLocation: string;
  dropLocation: string;
  pickupAt: string;
  tripDays: number;
  guestPhone: string;
  guestName: string | null;
  vehicleModel: string;
  vehicleNumber: string;
}): string {
  const template = requireTemplate("driver_assignment_v1");
  return renderMessageTemplate(template.body_template, {
    driver_name: input.driverName,
    pickup: input.pickupLocation,
    drop: input.dropLocation,
    guest_name: input.guestName ?? "Guest",
    guest_phone: input.guestPhone,
    vehicle_model: input.vehicleModel,
    vehicle_number: input.vehicleNumber,
    ...tripDateVariables(input.pickupAt, input.tripDays),
  });
}

export function buildVendorNotificationMessage(input: {
  pickupLocation: string;
  dropLocation: string;
  pickupAt: string;
  tripDays: number;
  paxCount: number;
  vehicleLabel: string;
  finalQuotePerDay: number;
}): string {
  const template = requireTemplate("vendor_booking_notify_v1");
  return renderMessageTemplate(template.body_template, {
    pickup: input.pickupLocation,
    drop: input.dropLocation,
    pax_count: String(input.paxCount),
    vehicle_label: input.vehicleLabel,
    final_quote: formatInr(input.finalQuotePerDay),
    ...tripDateVariables(input.pickupAt, input.tripDays),
  });
}

export function buildConfirmationMessage(input: {
  driverName: string;
  vehicleModel: string;
  vehicleNumber: string;
  pickupTime: string;
  pickupLocation: string;
  vendorName: string;
}): string {
  const template = requireTemplate("customer_confirmation_v1");
  return renderMessageTemplate(template.body_template, {
    driver_name: input.driverName,
    vehicle_model: input.vehicleModel,
    vehicle_number: input.vehicleNumber,
    pickup_time: input.pickupTime,
    pickup_location: input.pickupLocation,
    vendor_name: input.vendorName,
  });
}

export function buildQuoteMultiListMessage(input: {
  quoteRows: Array<{
    quoteSnapshotId: string;
    vendorName: string;
    pricePerDay: number;
    vehicleLabel: string;
  }>;
}): {
  bodyText: string;
  list: {
    buttonText: string;
    sections: Array<{ title: string; rows: Array<{ id: string; title: string; description: string }> }>;
  };
} {
  const templateKey = input.quoteRows.length > 1 ? "quote_multi_v1" : "quote_single_v1";
  const template = requireTemplate(templateKey);

  if (input.quoteRows.length === 1) {
    const row = input.quoteRows[0];
    const pricePerDay = `${formatInr(row.pricePerDay)}/day`;
    const bodyText = renderMessageTemplate(template.body_template, {
      vendor_name: row.vendorName,
      price_per_day: pricePerDay,
      vehicle_label: row.vehicleLabel,
    });

    return {
      bodyText,
      list: buildListFromTemplate(template, [
        {
          id: `BOOK_TOKEN::${row.quoteSnapshotId}`,
          title: row.vendorName.slice(0, 24),
          description: `${pricePerDay} \u00b7 ${row.vehicleLabel}`.slice(0, 72),
        },
      ]),
    };
  }

  const bodyLines = input.quoteRows.map(
    (row) => `${row.vendorName}: ${formatInr(row.pricePerDay)}/day (${row.vehicleLabel})`,
  );
  const joinedLines = bodyLines.join("\n");
  const bodyText = renderMessageTemplate(template.body_template, {
    quote_lines: joinedLines,
  });

  return {
    bodyText,
    list: buildListFromTemplate(
      template,
      input.quoteRows.slice(0, 10).map((row) => ({
        id: `BOOK_TOKEN::${row.quoteSnapshotId}`,
        title: row.vendorName.slice(0, 24),
        description: `${formatInr(row.pricePerDay)}/day \u00b7 ${row.vehicleLabel}`.slice(0, 72),
      })),
    ),
  };
}

export function buildQuoteChoiceMessage(input: {
  trip: QuoteChoiceTripDetails;
  quotes: QuoteChoiceRow[];
}): {
  templateKey: "quote_choice_v1";
  bodyText: string;
  footerText: string;
  buttons: Array<{ id: string; title: string }>;
  msg91Components: Record<string, { type: string; value: string; subtype?: string }>;
} {
  const template = requireTemplate("quote_choice_v1");
  const quotes = input.quotes.slice(0, 3);
  const tripSummary = formatQuoteChoiceTripSummary(input.trip);
  const named = buildQuoteChoiceNamedVariables({ tripSummary, rows: quotes });
  const bodyText = renderMessageTemplate(template.body_template, named);
  const footerText = template.footer_template?.trim() || QUOTE_CHOICE_FOOTER;

  return {
    templateKey: "quote_choice_v1",
    bodyText,
    footerText,
    buttons: buildQuoteChoiceSessionButtons(quotes),
    msg91Components: buildQuoteChoiceMsg91Components({ tripSummary, rows: quotes }),
  };
}
