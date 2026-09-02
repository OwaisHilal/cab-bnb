/**
 * WhatsApp copy builders for Edge handlers — templates loaded from DB via messageTemplateStore.
 */

import {
  getMessageTemplate,
  renderMessageTemplate,
  type WhatsAppMessageTemplateRow,
} from "./messageTemplateStore.ts";

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
