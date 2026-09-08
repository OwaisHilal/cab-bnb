import { UPCOMING_DATES } from "./constants";
import type { BookingRequestDraft } from "./types";

type DateDraft = Pick<BookingRequestDraft, "selectedDateId" | "customDate">;

export function resolveTripStartDate(draft: DateDraft): string | null {
  const customDate = draft.customDate?.trim();
  if (customDate) return customDate;

  if (!draft.selectedDateId) return null;

  return UPCOMING_DATES.find((date) => date.id === draft.selectedDateId)?.isoDate ?? null;
}
