/**
 * Mirrors Plan §14 config flags. Values here are frontend-only defaults for the
 * pre-registration animation; the authoritative values live server-side once
 * Supabase config/env wiring lands (Checklist Phase 0/2).
 *
 * The per-row animation interval is now derived from this delay and the
 * real matched_vendor_count (features/booking-request/hooks/useBookingFlow.ts)
 * rather than a fixed constant, so the OTP modal always appears after
 * exactly this many milliseconds regardless of vendor count.
 */
export const QUOTE_REVEAL_DELAY_MS = 4500;

/**
 * How long after the matching screen appears the OTP sheet rises over it.
 * Short enough to read as one continuous reveal, long enough that the two
 * don't pop in on the same frame.
 */
export const OTP_SHEET_REVEAL_DELAY_MS = 500;
