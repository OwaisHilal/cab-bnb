export type QuoteSnapshotStatusUi =
  | "pending_send"
  | "sent"
  | "viewed"
  | "negotiating"
  | "finalized"
  | "expired"
  | "lost";

export interface QuoteRowUi {
  id: string;
  vendorName: string;
  priceLabel: string;
  isBestPrice: boolean;
  status: QuoteSnapshotStatusUi;
  isNew: boolean;
}

export interface BookingSummaryUi {
  bookingRef: string;
  summaryLabel: string;
  quotes: QuoteRowUi[];
  /**
   * True while polling GET /api/trip-requests/[id] for the first batch of
   * quote_snapshots (Checklist 2.2 fallback path) and no rows have arrived
   * yet — lets the UI distinguish "still matching, quotes on the way" from
   * "polling gave up, check WhatsApp directly".
   */
  isAwaitingQuotes: boolean;
}
