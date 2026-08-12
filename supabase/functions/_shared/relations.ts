/**
 * Supabase-js embeds (`table(...)`) type as `T | T[] | null` depending on
 * whether the relationship is inferred as one-to-one or one-to-many from
 * the schema — this normalizes either shape to a single row. Shared here
 * because Phase 3's post-booking handlers (Checklist 3.5-3.9) all join
 * across `bookings`/`vendors`/`tourists`/`vehicle_types` the same way
 * `_shared/handlers/sendQuotes.ts` and `computeNegotiation.ts` already do
 * locally.
 */
export function firstOrSelf<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}
