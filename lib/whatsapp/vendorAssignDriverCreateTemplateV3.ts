import { getAppBaseUrl } from "@/lib/utils/appUrl"

/**
 * Facebook/WABA-shaped create body for `vendor_assign_driver_v3`
 * (`POST /api/v5/whatsapp/client-panel-template/`), mirroring
 * lib/whatsapp/vendorAssignDriverCreateTemplate.ts's v2 builder.
 *
 * v3 keeps the exact same 9 numbered booking-summary variables and the
 * same "Assign driver" URL button as v2 — only the trailing CTA sentence
 * changes, dropping the long `Optional: DRIVER: <name> | <phone> | ...`
 * line that most vendors never used and that made the WhatsApp message
 * harder to scan on a phone (see docs/2026-09-23-vendor-assign-ux.md).
 *
 * IMPORTANT: creating this template does NOT switch live traffic.
 * `vendor_assign_driver_v2` stays the default in
 * lib/whatsapp/templateEnv.ts until MSG91/Meta approves v3 — see the
 * `template-v3-switch` step, which flips that default afterwards.
 */
export const MSG91_VENDOR_ASSIGN_DRIVER_V3_TEMPLATE_NAME = "vendor_assign_driver_v3"
export const VENDOR_ASSIGN_DRIVER_V3_CTA_TITLE = "Assign driver"

export const VENDOR_ASSIGN_DRIVER_V3_DASHBOARD_BODY = [
  "New booking confirmed.",
  "",
  "Guest: {{1}}",
  "Route: {{2}} → {{3}}",
  "Date: {{4}}, {{5}} {{6}}",
  "Pax: {{7}} | Cab: {{8}}",
  "Total: {{9}}",
  "",
  "Reply with the driver's 10-digit mobile number, or tap Assign driver below.",
].join("\n")

/** Same sample values already published for v2 — the variable set is unchanged. */
export const VENDOR_ASSIGN_DRIVER_V3_SAMPLE_VARIABLES = {
  "1": "Rahul Sharma",
  "2": "Srinagar",
  "3": "Pahalgam",
  "4": "14 Aug",
  "5": "3",
  "6": "days",
  "7": "4",
  "8": "Sedan",
  "9": "₹52,500",
} as const

export const vendorAssignDriverV3ButtonUrlTemplate = (): string =>
  `${getAppBaseUrl()}/vendor/assign-driver?token={{1}}`

export interface VendorAssignDriverV3CreateApiBody {
  integrated_number: string
  template_name: string
  name: string
  language: string
  category: "UTILITY"
  allow_category_change: false
  components: Array<Record<string, unknown>>
}

/**
 * @param integratedNumber MSG91 WhatsApp integrated number (E.164, `+` optional).
 * @param buttonUrlExample Sample dynamic URL suffix for Meta's review (the
 *   button's `{{1}}`) — a real signed token is far shorter than the 2000
 *   character limit WhatsApp allows here.
 */
export const buildVendorAssignDriverV3CreateApiBody = (
  integratedNumber: string,
  buttonUrlExample: string,
): VendorAssignDriverV3CreateApiBody => {
  return {
    integrated_number: integratedNumber.replace(/^\+/, ""),
    template_name: MSG91_VENDOR_ASSIGN_DRIVER_V3_TEMPLATE_NAME,
    name: MSG91_VENDOR_ASSIGN_DRIVER_V3_TEMPLATE_NAME,
    language: "en_US",
    category: "UTILITY",
    allow_category_change: false,
    components: [
      {
        type: "BODY",
        text: VENDOR_ASSIGN_DRIVER_V3_DASHBOARD_BODY,
        example: {
          body_text: [
            [
              VENDOR_ASSIGN_DRIVER_V3_SAMPLE_VARIABLES["1"],
              VENDOR_ASSIGN_DRIVER_V3_SAMPLE_VARIABLES["2"],
              VENDOR_ASSIGN_DRIVER_V3_SAMPLE_VARIABLES["3"],
              VENDOR_ASSIGN_DRIVER_V3_SAMPLE_VARIABLES["4"],
              VENDOR_ASSIGN_DRIVER_V3_SAMPLE_VARIABLES["5"],
              VENDOR_ASSIGN_DRIVER_V3_SAMPLE_VARIABLES["6"],
              VENDOR_ASSIGN_DRIVER_V3_SAMPLE_VARIABLES["7"],
              VENDOR_ASSIGN_DRIVER_V3_SAMPLE_VARIABLES["8"],
              VENDOR_ASSIGN_DRIVER_V3_SAMPLE_VARIABLES["9"],
            ],
          ],
        },
      },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "URL",
            text: VENDOR_ASSIGN_DRIVER_V3_CTA_TITLE,
            url: vendorAssignDriverV3ButtonUrlTemplate(),
            example: [buttonUrlExample],
          },
        ],
      },
    ],
  }
}
