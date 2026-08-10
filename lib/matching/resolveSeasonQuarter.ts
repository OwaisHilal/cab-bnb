import type { SeasonQuarter } from "./types";

/**
 * Neither the engineering plan nor the Supabase checklist defines exact
 * calendar ranges for the `PEAK` / `OFF_PEAK` values of
 * `vendor_rate_bands.season_quarter` — only that matching always includes
 * `season_quarter = resolved OR season_quarter = 'ALL_YEAR'` (Checklist §3.1).
 *
 * This resolver uses plain calendar quarters (Q1 Jan-Mar, Q2 Apr-Jun,
 * Q3 Jul-Sep, Q4 Oct-Dec) as a safe default: it only narrows matches for rows
 * a vendor explicitly tags Q1-Q4, and never affects `ALL_YEAR` / `PEAK` /
 * `OFF_PEAK` rows, which are presumably set manually by whoever manages
 * `vendor_rate_bands`. Revisit this if/when PEAK/OFF_PEAK date ranges are
 * defined by the product.
 */
export function resolveSeasonQuarter(tripStartDate: string): SeasonQuarter {
  const month = new Date(tripStartDate).getUTCMonth();

  if (month <= 2) return "Q1";
  if (month <= 5) return "Q2";
  if (month <= 8) return "Q3";
  return "Q4";
}
