import { getAppBaseUrl } from "@/lib/utils/appUrl"

/**
 * Facebook/WABA-shaped create body for `vendor_assign_driver_v2`
 * (`POST /api/v5/whatsapp/client-panel-template/`), mirroring
 * `lib/whatsapp/quoteChoiceTemplate.ts`'s `buildQuoteChoiceCreateApiBody`.
 * MSG91's own create-template docs (docs.msg91.com/whatsapp/create-whatsapp-template)
 * do not publish a JSON example and explicitly point developers at Meta's
 * component docs for structure — so this shape is Meta-doc-verified
 * (BODY `example.body_text`, BUTTONS[].type "URL" with a required `example`
 * array whenever the url contains a `{{n}}` variable) wrapped in MSG91's
 * known top-level envelope (integrated_number/template_name/name/language/
 * category/allow_category_change/components), same as the working
 * `quote_choice_v2` precedent.
 *
 * Body copy is byte-for-byte the same as `vendor_assign_driver_v1`'s
 * `dashboard_body` (supabase/migrations/20260903000200_0016_...sql) — only
 * a new BUTTONS component is added — to minimize Meta re-review risk.
 */
export const MSG91_VENDOR_ASSIGN_DRIVER_TEMPLATE_NAME = "vendor_assign_driver_v2"
export const VENDOR_ASSIGN_DRIVER_CTA_TITLE = "Assign driver"

export const VENDOR_ASSIGN_DRIVER_DASHBOARD_BODY = [
  "New booking confirmed.",
  "",
  "Guest: {{1}}",
  "Route: {{2}} → {{3}}",
  "Date: {{4}}, {{5}} {{6}}",
  "Pax: {{7}} | Cab: {{8}}",
  "Total: {{9}}",
  "",
  "Reply with the driver's 10-digit mobile to assign.",
  "Optional: DRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>",
].join("\n")

/** Same sample values already published in docs/2026-09-21-vendor-assign-driver-v2-template.md. */
export const VENDOR_ASSIGN_DRIVER_SAMPLE_VARIABLES = {
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

export const vendorAssignDriverButtonUrlTemplate = (): string =>
  `${getAppBaseUrl()}/vendor/assign-driver?token={{1}}`

export interface VendorAssignDriverCreateApiBody {
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
export const buildVendorAssignDriverV2CreateApiBody = (
  integratedNumber: string,
  buttonUrlExample: string,
): VendorAssignDriverCreateApiBody => {
  return {
    integrated_number: integratedNumber.replace(/^\+/, ""),
    template_name: MSG91_VENDOR_ASSIGN_DRIVER_TEMPLATE_NAME,
    name: MSG91_VENDOR_ASSIGN_DRIVER_TEMPLATE_NAME,
    language: "en_US",
    category: "UTILITY",
    allow_category_change: false,
    components: [
      {
        type: "BODY",
        text: VENDOR_ASSIGN_DRIVER_DASHBOARD_BODY,
        example: {
          body_text: [
            [
              VENDOR_ASSIGN_DRIVER_SAMPLE_VARIABLES["1"],
              VENDOR_ASSIGN_DRIVER_SAMPLE_VARIABLES["2"],
              VENDOR_ASSIGN_DRIVER_SAMPLE_VARIABLES["3"],
              VENDOR_ASSIGN_DRIVER_SAMPLE_VARIABLES["4"],
              VENDOR_ASSIGN_DRIVER_SAMPLE_VARIABLES["5"],
              VENDOR_ASSIGN_DRIVER_SAMPLE_VARIABLES["6"],
              VENDOR_ASSIGN_DRIVER_SAMPLE_VARIABLES["7"],
              VENDOR_ASSIGN_DRIVER_SAMPLE_VARIABLES["8"],
              VENDOR_ASSIGN_DRIVER_SAMPLE_VARIABLES["9"],
            ],
          ],
        },
      },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "URL",
            text: VENDOR_ASSIGN_DRIVER_CTA_TITLE,
            url: vendorAssignDriverButtonUrlTemplate(),
            example: [buttonUrlExample],
          },
        ],
      },
    ],
  }
}
